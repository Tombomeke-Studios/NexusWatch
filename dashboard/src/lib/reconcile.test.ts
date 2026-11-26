import { describe, expect, it } from 'vitest';
import type { TopUpRecord } from '@/api/types';
import { CREDIT_GRACE_MS, reconcile, reconcileAll, summarize, type AnomalyKind } from './reconcile';

const NOW = new Date('2026-11-05T12:00:00Z');
const MIN = 60_000;
const TIMEOUT = 30 * MIN;
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * MIN).toISOString();

/** A healthy top-up: requested 60 min ago, confirmed 5 min later, credited a second after that. */
function topUp(patch: Partial<TopUpRecord> = {}): TopUpRecord {
  return {
    reference: 'tu_1',
    accountId: 'acc_1',
    payer: null,
    amountEur: 25,
    requestedAt: at(60),
    sent: true,
    status: 'confirmed',
    expiredAt: null,
    finvault: { outcome: 'confirmed', at: at(55), amountEur: 25, reason: null },
    credits: [{ at: new Date(NOW.getTime() - 55 * MIN + 1000).toISOString(), amountEur: 25 }],
    ...patch,
  };
}

const kinds = (r: TopUpRecord, now = NOW) => reconcile(r, { now, timeoutMs: TIMEOUT }).anomalies.map((a) => a.kind);

describe('reconcile', () => {
  it('passes a top-up that was sent, confirmed and credited once for the amount asked', () => {
    const r = reconcile(topUp(), { now: NOW, timeoutMs: TIMEOUT });
    expect(r.anomalies).toEqual([]);
    expect(r.outcome).toBe('credited');
    expect(r.steps).toEqual({ request: 'done', finvault: 'done', credit: 'done' });
    expect(r.timeToCreditMs).toBe(5 * MIN + 1000);
  });

  it('treats a request the broker never took as failed at once, not pending', () => {
    const r = reconcile(topUp({ sent: false, status: 'failed', finvault: null, credits: [] }), { now: NOW, timeoutMs: TIMEOUT });
    expect(r.outcome).toBe('failed');
    expect(r.steps).toEqual({ request: 'failed', finvault: 'skipped', credit: 'skipped' });
    expect(r.anomalies).toEqual([]);
  });

  it('accepts a payment FinVault failed (declined) and nothing credited', () => {
    const r = reconcile(topUp({ status: 'failed', finvault: { outcome: 'failed', at: at(50), amountEur: 25, reason: 'declined by customer' }, credits: [] }), { now: NOW, timeoutMs: TIMEOUT });
    expect(r.outcome).toBe('failed');
    expect(r.steps.finvault).toBe('failed');
    expect(r.steps.credit).toBe('skipped');
    expect(r.anomalies).toEqual([]);
  });

  it('keeps an unanswered top-up in flight until the timeout', () => {
    const r = reconcile(topUp({ requestedAt: at(10), status: 'pending', finvault: null, credits: [] }), { now: NOW, timeoutMs: TIMEOUT });
    expect(r.outcome).toBe('in-flight');
    expect(r.steps).toEqual({ request: 'done', finvault: 'waiting', credit: 'waiting' });
    expect(r.anomalies).toEqual([]);
  });

  it('gives the bridge a grace period between a confirmation and the credit', () => {
    const justConfirmed = topUp({ requestedAt: at(3), finvault: { outcome: 'confirmed', at: new Date(NOW.getTime() - CREDIT_GRACE_MS / 2).toISOString(), amountEur: 25, reason: null }, credits: [] });
    const r = reconcile(justConfirmed, { now: NOW, timeoutMs: TIMEOUT });
    expect(r.outcome).toBe('in-flight');
    expect(r.steps.credit).toBe('waiting');
    expect(r.anomalies).toEqual([]);
  });

  describe('anomalies', () => {
    it('flags confirmed but not credited once the grace period is over', () => {
      const r = reconcile(topUp({ credits: [] }), { now: NOW, timeoutMs: TIMEOUT });
      expect(r.anomalies.map((a) => a.kind)).toEqual(['confirmed-not-credited']);
      expect(r.anomalies[0].severity).toBe('critical');
      expect(r.anomalies[0].reason).toMatch(/FinVault confirmed €25\.00 .* no credit/);
      expect(r.outcome).toBe('anomaly');
      expect(r.steps.credit).toBe('failed');
    });

    it('flags a top-up credited twice, with the extra amount', () => {
      const credit = { at: at(54), amountEur: 25 };
      const r = reconcile(topUp({ credits: [credit, { ...credit, at: at(53) }] }), { now: NOW, timeoutMs: TIMEOUT });
      expect(r.anomalies.map((a) => a.kind)).toEqual(['credited-twice']);
      expect(r.anomalies[0].reason).toMatch(/2 times .* €25\.00 too much/);
    });

    it('flags a confirmation for a different amount than requested, and does not also call it uncredited', () => {
      const r = reconcile(topUp({ finvault: { outcome: 'confirmed', at: at(55), amountEur: 2.5, reason: null }, credits: [] }), { now: NOW, timeoutMs: TIMEOUT });
      expect(r.anomalies.map((a) => a.kind)).toEqual(['amount-mismatch']);
      expect(r.anomalies[0].reason).toMatch(/Requested €25\.00, FinVault confirmed €2\.50/);
    });

    it('flags a credit for a different amount than requested', () => {
      const r = reconcile(topUp({ credits: [{ at: at(54), amountEur: 20 }] }), { now: NOW, timeoutMs: TIMEOUT });
      expect(r.anomalies.map((a) => a.kind)).toEqual(['amount-mismatch']);
      expect(r.anomalies[0].reason).toMatch(/credited €20\.00/);
    });

    it('ignores sub-cent float noise when comparing amounts', () => {
      expect(kinds(topUp({ amountEur: 0.1 + 0.2, finvault: { outcome: 'confirmed', at: at(55), amountEur: 0.3, reason: null }, credits: [{ at: at(54), amountEur: 0.3 }] }))).toEqual([]);
    });

    it('flags a top-up stuck without an answer past the timeout', () => {
      const r = reconcile(topUp({ requestedAt: at(45), status: 'not-confirmed', expiredAt: at(15), finvault: null, credits: [] }), { now: NOW, timeoutMs: TIMEOUT });
      expect(r.anomalies.map((a) => a.kind)).toEqual(['stuck-not-confirmed']);
      expect(r.anomalies[0].severity).toBe('warning');
      expect(r.anomalies[0].reason).toMatch(/No answer from FinVault after 45 min/);
      expect(r.outcome).toBe('not-confirmed');
      expect(r.steps.finvault).toBe('failed');
    });

    it('says so when the bridge never expired a top-up past its timeout', () => {
      const r = reconcile(topUp({ requestedAt: at(45), status: 'pending', finvault: null, credits: [] }), { now: NOW, timeoutMs: TIMEOUT });
      expect(r.anomalies[0].kind).toBe('stuck-not-confirmed');
      expect(r.anomalies[0].reason).toMatch(/still says pending/);
    });

    it('notes a late confirmation after a timeout, credited as it should be (#298)', () => {
      const r = reconcile(topUp({ requestedAt: at(90), expiredAt: at(60), finvault: { outcome: 'confirmed', at: at(40), amountEur: 25, reason: null }, credits: [{ at: at(40), amountEur: 25 }] }), { now: NOW, timeoutMs: TIMEOUT });
      expect(r.anomalies.map((a) => a.kind)).toEqual(['late-confirmation']);
      expect(r.anomalies[0].severity).toBe('info');
      expect(r.anomalies[0].reason).toMatch(/20 min after the top-up turned Not confirmed/);
      expect(r.outcome).toBe('credited');
      expect(r.steps.finvault).toBe('late');
    });

    it('detects a late confirmation by the clock even when the bridge never expired it', () => {
      expect(kinds(topUp({ requestedAt: at(90), finvault: { outcome: 'confirmed', at: at(40), amountEur: 25, reason: null }, credits: [{ at: at(40), amountEur: 25 }] }))).toEqual(['late-confirmation']);
    });

    it('raises a late confirmation that was not credited as both', () => {
      expect(kinds(topUp({ requestedAt: at(90), expiredAt: at(60), finvault: { outcome: 'confirmed', at: at(40), amountEur: 25, reason: null }, credits: [] }))).toEqual(['confirmed-not-credited', 'late-confirmation']);
    });

    it('flags credit with no confirmation behind it', () => {
      const r = reconcile(topUp({ finvault: { outcome: 'failed', at: at(55), amountEur: 25, reason: 'insufficient funds' } }), { now: NOW, timeoutMs: TIMEOUT });
      expect(r.anomalies.map((a) => a.kind)).toEqual(['credited-without-confirmation']);
      expect(r.anomalies[0].reason).toMatch(/FinVault failed it/);
      expect(kinds(topUp({ finvault: null }))).toEqual(['credited-without-confirmation']);
    });

    it('sorts anomalies most severe first', () => {
      const severities = reconcile(topUp({ requestedAt: at(90), expiredAt: at(60), finvault: { outcome: 'confirmed', at: at(40), amountEur: 25, reason: null }, credits: [] }), { now: NOW, timeoutMs: TIMEOUT }).anomalies.map((a) => a.severity);
      expect(severities).toEqual(['critical', 'info']);
    });
  });
});

describe('credits not observed (bus-only backend)', () => {
  const unseen = (patch: Partial<TopUpRecord> = {}) => topUp({ status: null, credits: null, ...patch });

  it('calls a confirmed top-up confirmed, never credited and never "not credited"', () => {
    const r = reconcile(unseen(), { now: NOW, timeoutMs: TIMEOUT });
    expect(r.anomalies).toEqual([]);
    expect(r.outcome).toBe('confirmed');
    expect(r.steps).toEqual({ request: 'done', finvault: 'done', credit: 'unknown' });
    expect(r.timeToCreditMs).toBeNull();
  });

  it('still flags what the bus shows: an amount mismatch and a top-up stuck without answer', () => {
    expect(kinds(unseen({ finvault: { outcome: 'confirmed', at: at(55), amountEur: 20, reason: null } }))).toEqual(['amount-mismatch']);
    expect(kinds(unseen({ finvault: null }))).toEqual(['stuck-not-confirmed']);
  });

  it('skips the wallet step after a failure and waits while FinVault has not answered', () => {
    expect(reconcile(unseen({ finvault: { outcome: 'failed', at: at(50), amountEur: 25, reason: 'declined' } }), { now: NOW, timeoutMs: TIMEOUT }).steps.credit).toBe('skipped');
    expect(reconcile(unseen({ requestedAt: at(5), finvault: null }), { now: NOW, timeoutMs: TIMEOUT })).toMatchObject({ outcome: 'in-flight', steps: { credit: 'waiting' } });
  });

  it('counts confirmed top-ups as succeeded in the summary', () => {
    const s = summarize(reconcileAll([unseen(), topUp(), unseen({ finvault: { outcome: 'failed', at: at(50), amountEur: 25, reason: null } })], { now: NOW, timeoutMs: TIMEOUT }));
    expect(s).toMatchObject({ settled: 3, credited: 1, confirmed: 1 });
    expect(s.successRate).toBeCloseTo(66.67, 1);
  });
});

describe('summarize', () => {
  const opts = { now: NOW, timeoutMs: TIMEOUT };

  it('reports unknown (null), not zero, when nothing has settled', () => {
    const s = summarize(reconcileAll([topUp({ requestedAt: at(5), status: 'pending', finvault: null, credits: [] })], opts));
    expect(s.successRate).toBeNull();
    expect(s.medianTimeToCreditMs).toBeNull();
    expect(s.inFlight).toBe(1);
    expect(s.settled).toBe(0);
  });

  it('counts success over settled top-ups only, and anomalies by severity', () => {
    const rows = reconcileAll(
      [
        topUp({ reference: 'a' }),
        topUp({ reference: 'b', credits: [] }), // confirmed, not credited
        topUp({ reference: 'c', sent: false, status: 'failed', finvault: null, credits: [] }),
        topUp({ reference: 'd', requestedAt: at(2), status: 'pending', finvault: null, credits: [] }), // in flight
        topUp({ reference: 'e', requestedAt: at(90), expiredAt: at(60), finvault: { outcome: 'confirmed', at: at(40), amountEur: 25, reason: null }, credits: [{ at: at(40), amountEur: 25 }] }),
      ],
      opts,
    );
    const s = summarize(rows);
    expect(s.settled).toBe(4);
    expect(s.credited).toBe(2);
    expect(s.successRate).toBeCloseTo(50);
    expect(s.openAnomalies).toBe(1);
    expect(s.notedAnomalies).toBe(1);
    expect(s.byKind['confirmed-not-credited']).toBe(1);
    expect(s.byKind['late-confirmation']).toBe(1);
  });

  it('takes the median time to credit (middle of an odd set, mean of the two middles otherwise)', () => {
    const credited = (ref: string, minutes: number) => topUp({ reference: ref, requestedAt: at(100), finvault: { outcome: 'confirmed', at: at(100 - minutes), amountEur: 25, reason: null }, credits: [{ at: at(100 - minutes), amountEur: 25 }] });
    const odd = summarize(reconcileAll([credited('a', 1), credited('b', 3), credited('c', 20)], { ...opts, timeoutMs: 60 * MIN }));
    expect(odd.medianTimeToCreditMs).toBe(3 * MIN);
    const even = summarize(reconcileAll([credited('a', 1), credited('b', 3), credited('c', 5), credited('d', 20)], { ...opts, timeoutMs: 60 * MIN }));
    expect(even.medianTimeToCreditMs).toBe(4 * MIN);
  });

  it('has a count for every anomaly kind, zero included', () => {
    const all: AnomalyKind[] = ['confirmed-not-credited', 'credited-twice', 'amount-mismatch', 'stuck-not-confirmed', 'late-confirmation', 'credited-without-confirmation'];
    expect(Object.keys(summarize([]).byKind).sort()).toEqual([...all].sort());
  });
});
