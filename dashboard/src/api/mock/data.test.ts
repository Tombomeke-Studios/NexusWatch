import { describe, expect, it } from 'vitest';
import * as mock from './data';
import { ANOMALY_KINDS, reconcileAll, summarize } from '@/lib/reconcile';

/** The mock data stands in for the backend, so it must keep the contract's invariants. */
describe('mock data', () => {
  it('counts services consistently in the overview KPIs', () => {
    const o = mock.overview();
    expect(o.kpis.servicesTotal).toBe(o.services.length);
    expect(o.kpis.servicesUp + o.kpis.servicesSlow + o.kpis.servicesDown).toBe(o.kpis.servicesTotal);
  });

  it('gives every service 48 beats and a down service a null latency', () => {
    for (const s of mock.services) {
      expect(s.beats).toHaveLength(48);
      if (s.status === 'down') expect(s.latencyMs).toBeNull();
    }
  });

  it('filters logs by level, project and text', () => {
    const errors = mock.logs({ query: '', range: '24h', levels: ['error'], project: 'finvault' });
    expect(errors.entries.length).toBeGreaterThan(0);
    expect(errors.entries.every((e) => e.level === 'error' && e.project === 'finvault')).toBe(true);
    const text = mock.logs({ query: 'prisma', range: '24h', levels: [] });
    expect(text.entries.every((e) => e.message.toLowerCase().includes('prisma'))).toBe(true);
  });

  it('links log lines to monitored services', () => {
    const { entries } = mock.logs({ query: 'healthcheck', range: '24h', levels: [] });
    expect(entries[0].serviceId).toBe('fv-invoice-service');
  });

  it('returns null for an unknown service and a detail for a known one', () => {
    expect(mock.serviceDetail('nope')).toBeNull();
    const detail = mock.serviceDetail('fv-invoice-service');
    expect(detail?.downSince).not.toBeNull();
    expect(detail?.checks).toHaveLength(120);
  });

  it('persists rule toggles and acknowledgements', () => {
    mock.setRuleEnabled('r8', true);
    mock.acknowledgeAlert('al_1', 'Looking into it');
    const a = mock.alerts();
    expect(a.rules.find((r) => r.id === 'r8')?.enabled).toBe(true);
    const al1 = a.active.find((x) => x.id === 'al_1');
    expect(al1?.acknowledged).toBe(true);
    expect(al1?.acknowledgedAt).not.toBeNull();
    expect(al1?.notes).toMatchObject([{ kind: 'acknowledged', text: 'Looking into it' }]);
    expect(a.history.find((h) => h.alertId === 'al_1')?.notes).toHaveLength(1);
  });

  it('marks every sample channel configured and answers a channel test without sending', () => {
    for (const c of mock.settings().channels) {
      expect(c.configured).toBe(true);
      expect(mock.testChannel(c.id)).toMatchObject({ ok: true });
    }
    expect(() => mock.testChannel('fax')).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('routes every severity to every configured channel, Telegram included', () => {
    const s = mock.settings();
    const ids = s.channels.map((c) => c.id);
    expect(ids).toContain('telegram');
    for (const severity of ['critical', 'warning', 'info'] as const) {
      expect(Object.keys(s.routing[severity]).sort()).toEqual([...ids].sort());
    }
  });

  it('returns a series per configured line for every metric', () => {
    for (const id of mock.metricIds) {
      const m = mock.metric(id);
      expect(m.series.length).toBeGreaterThan(0);
      m.series.forEach((s) => expect(s.values).toHaveLength(90));
    }
  });
});

/** The Business mock stands in for what the collector will read from both billing sides. */
describe('business mock', () => {
  const b = mock.business();
  const opts = { now: new Date(), timeoutMs: b.topUpTimeoutMs };

  it('lists top-ups newest first with unique references', () => {
    const times = b.topUps.map((t) => new Date(t.requestedAt).getTime());
    expect(times).toEqual([...times].sort((x, y) => y - x));
    expect(new Set(b.topUps.map((t) => t.reference)).size).toBe(b.topUps.length);
  });

  it('never carries a full email address', () => {
    const everything = JSON.stringify(b);
    for (const match of everything.match(/[^\s"]+@[^\s"]+/g) ?? []) expect(match).toMatch(/^.\*\*\*@.\*\*\*\./);
  });

  it('keeps the bridge rules: not sent is failed, never pending; an expired top-up has no answer before its expiry', () => {
    for (const t of b.topUps) {
      if (!t.sent) expect(t.status).toBe('failed');
      if (t.expiredAt && t.finvault) expect(new Date(t.finvault.at).getTime()).not.toBe(new Date(t.expiredAt).getTime());
    }
  });

  it('seeds each anomaly the page must show, and some healthy top-ups', () => {
    const s = summarize(reconcileAll(b.topUps, opts));
    const seeded = ANOMALY_KINDS.filter((k) => k !== 'credited-without-confirmation');
    for (const kind of seeded) expect(s.byKind[kind], kind).toBeGreaterThan(0);
    expect(s.credited).toBeGreaterThan(s.openAnomalies);
    expect(s.inFlight).toBeGreaterThan(0);
  });

  it('gives no estimate (null), not zero hours, to an account with nothing running', () => {
    for (const a of b.accounts) {
      if (a.runningServers === 0) expect(a.hoursLeft).toBeNull();
      else expect(a.hoursLeft).not.toBeNull();
      expect(a.availableEur).toBeLessThanOrEqual(a.balanceEur);
    }
  });

  it('suspends only servers of accounts that cannot run', () => {
    for (const s of b.suspended) expect(b.accounts.find((a) => a.accountId === s.accountId)?.canRun).toBe(false);
  });

  it('sums each plan’s 30 days into its revenue', () => {
    for (const p of b.revenueByPlan) {
      expect(p.perDay).toHaveLength(30);
      expect(p.revenueEur).toBeCloseTo(p.perDay.reduce((x, y) => x + y, 0), 1);
    }
  });

  it('reports unknown as null on the bus, with a reason for an unknown DLQ', () => {
    expect(b.bus.throughputPerMin).toHaveLength(60);
    if (b.bus.dlq.depth === null) expect(b.bus.dlq.error).toBeTruthy();
    expect(b.bus.queues.some((q) => q.consumers === null)).toBe(true);
    for (const o of b.bus.outboxes) expect(o.pending === null).toBe(o.dropped === null);
  });
});
