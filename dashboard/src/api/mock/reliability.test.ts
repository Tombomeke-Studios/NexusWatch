import { describe, expect, expectTypeOf, it } from 'vitest';
import { budgetRemaining, burnRate, evaluateBurnAlerts, sumTallies } from '@/lib/slo';
import type { BurnWindow, StatusPageData } from '../types';
import * as mock from './data';
import * as reliability from './reliability';

/** The mock stands in for the backend: these invariants become contract tests against the real API. */
describe('mock SLOs', () => {
  const { slos } = reliability.slos();

  it('has one SLO per monitored service, with a target that leaves a budget', () => {
    expect(slos.map((s) => s.serviceId).sort()).toEqual(mock.services.map((s) => s.id).sort());
    for (const s of slos) {
      expect(s.targetPct).toBeGreaterThan(0);
      expect(s.targetPct).toBeLessThan(100);
    }
  });

  it('gives every day of the window a tally, adding up to the window', () => {
    for (const s of slos) {
      expect(s.daily).toHaveLength(s.windowDays);
      expect(sumTallies(s.daily)).toEqual(s.window);
      for (const t of [...s.daily, ...Object.values(s.burnWindows)]) {
        expect(Math.min(t.good, t.bad, t.unknown)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('never loses failures as a burn window grows', () => {
    const order: BurnWindow[] = ['5m', '30m', '1h', '2h', '6h', '24h'];
    for (const s of slos) {
      const bad = order.map((w) => s.burnWindows[w].bad);
      expect([...bad].sort((a, b) => a - b)).toEqual(bad);
      expect(s.daily.at(-1)!.bad).toBeGreaterThanOrEqual(s.burnWindows['24h'].bad);
    }
  });

  it('shows the down service burning fast and over budget, and a healthy one quiet', () => {
    const invoice = slos.find((s) => s.serviceId === 'fv-invoice-service')!;
    const burn = (w: BurnWindow) => burnRate(invoice.targetPct, invoice.burnWindows[w]);
    expect(evaluateBurnAlerts({ '5m': burn('5m'), '30m': burn('30m'), '1h': burn('1h'), '2h': burn('2h'), '6h': burn('6h'), '24h': burn('24h') }, 30).map((a) => a.id)).toContain('fast');
    expect(budgetRemaining(invoice.targetPct, invoice.window)).toBeLessThan(0);
    const gateway = slos.find((s) => s.serviceId === 'nx-api-gateway')!;
    expect(budgetRemaining(gateway.targetPct, gateway.window)).toBeGreaterThan(0.5);
  });

  it('reports gaps as unknown, not as failures', () => {
    const node02 = slos.find((s) => s.serviceId === 'nx-agent-node-02')!;
    expect(node02.daily.at(-2)!.unknown).toBeGreaterThan(node02.daily.at(-2)!.bad);
  });
});

describe('mock incidents', () => {
  it('lists open incidents first, then newest first, with consistent durations', () => {
    const { incidents, summary } = reliability.incidents();
    const open = incidents.filter((i) => i.status !== 'resolved');
    expect(incidents.slice(0, open.length)).toEqual(open);
    expect(summary.open).toBe(open.length);
    for (const i of incidents) {
      expect(i.affected.length).toBeGreaterThan(0);
      expect(i.resolvedAt === null).toBe(i.status !== 'resolved');
      expect(i.updates[0].status).toBe(i.status);
      expect(i.durationSeconds).toBeGreaterThanOrEqual(0);
    }
  });

  it('feeds Heartbeats from the same store, so every listed incident has a page', () => {
    const listed = mock.heartbeats().incidents;
    expect(listed.length).toBeGreaterThan(0);
    for (const i of listed) expect(reliability.incident(i.id)?.title).toBe(i.title);
    expect(reliability.incident('nope')).toBeNull();
  });

  it('creates, updates and resolves an incident through its lifecycle', () => {
    const created = reliability.createIncident({ title: '  Queue stuck ', severity: 'warning', serviceIds: ['nx-rabbitmq'], message: 'Looking into it', public: false });
    expect(created).toMatchObject({ title: 'Queue stuck', status: 'investigating', resolvedAt: null, publicTitle: 'Queue stuck' });
    expect(created.affected).toEqual([{ serviceId: 'nx-rabbitmq', name: 'rabbitmq', project: 'nexusinfra' }]);

    const updated = reliability.postIncidentUpdate(created.id, { status: 'identified', message: 'Consumer crashed', public: false });
    expect(updated.status).toBe('identified');
    expect(updated.updates.map((u) => u.status)).toEqual(['identified', 'investigating']);

    const postmortem = { summary: 's', rootCause: 'r', actionItems: [{ id: 'a', title: 'Add a consumer alert', owner: 'tom', done: false }] };
    const resolved = reliability.resolveIncident(created.id, { message: 'Consumer restarted', public: false, postmortem });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.postmortem).toEqual(postmortem);
    expect(() => reliability.resolveIncident(created.id, { message: '', public: false, postmortem: null })).toThrow(/already resolved/);
    expect(() => reliability.postIncidentUpdate(created.id, { status: 'monitoring', message: 'x', public: false })).toThrow(/already resolved/);
  });

  it('refuses an incident without title or affected service', () => {
    expect(() => reliability.createIncident({ title: ' ', severity: 'info', serviceIds: ['nx-rabbitmq'], message: '', public: false })).toThrow();
    expect(() => reliability.createIncident({ title: 'x', severity: 'info', serviceIds: [], message: '', public: false })).toThrow();
  });
});

// ── Public status page: only public-safe fields ────────────────────────
type DeepKeys<T> = T extends readonly (infer U)[] ? DeepKeys<U> : T extends object ? { [K in keyof T]: K | DeepKeys<T[K]> }[keyof T] : never;
const FORBIDDEN_KEYS = ['host', 'address', 'port', 'target', 'ip', 'node', 'nodes', 'serviceId', 'serviceIds', 'author', 'fields', 'container'] as const;

function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe('public status page', () => {
  it('has no internal field in its type', () => {
    expectTypeOf<Extract<DeepKeys<StatusPageData>, (typeof FORBIDDEN_KEYS)[number]>>().toEqualTypeOf<never>();
  });

  it('serves no internal field at runtime', () => {
    const keys = allKeys(reliability.statusPage());
    for (const k of FORBIDDEN_KEYS) expect(keys.has(k), `key "${k}"`).toBe(false);
  });

  it('leaks no hosts, IPs, ports, node names or internal ids in any text', () => {
    // Strip ISO timestamps first: their "T10:14" would look like a port.
    const text = JSON.stringify(reliability.statusPage()).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '');
    expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/); // IPv4
    expect(text).not.toMatch(/[\w\]]:\d{2,5}\b/); // host:8003 (a JSON number follows `"key":`, so a quote, not a word)
    expect(text).not.toMatch(/localhost|https?:\/\/|tcp:\/\//i);
    expect(text).not.toMatch(/node-\d|vm-|ECONNREFUSED|P1001/i);
    for (const s of mock.services) expect(text).not.toContain(`"${s.id}"`);
  });

  it('leaves out internal incidents and internal updates', () => {
    const page = reliability.statusPage();
    const shown = [...page.active, ...page.recent];
    expect(shown.map((i) => i.slug)).not.toContain('inc_3'); // node-02 is internal
    const internal = reliability.incident('inc_4')!.updates.filter((u) => !u.public).map((u) => u.message);
    for (const i of shown) for (const u of i.updates) expect(internal).not.toContain(u.message);
  });

  it('gives every component 90 days and rolls an outage into the banner', () => {
    const page = reliability.statusPage();
    for (const g of page.groups) {
      for (const c of g.components) {
        expect(c.days).toHaveLength(90);
        expect(c.days[0]).toBeNull(); // monitoring started 85 days ago: no data, not "up"
      }
    }
    expect(page.groups.map((g) => g.project)).toEqual(['nexusinfra', 'finvault']);
    expect(page.overall).toBe('partial-outage');
    expect(page.active.map((i) => i.title)).toContain('Invoices unavailable');
    expect(page.maintenance.every((m) => m.endsAt > m.startsAt)).toBe(true);
  });
});

/** The collector stores this snapshot so declared incidents survive a restart. */
describe('mock incident state snapshot', () => {
  it('restores declared incidents and their updates from plain JSON', () => {
    const before = reliability.incidentState();
    try {
      const made = reliability.createIncident({ title: 'Snapshot incident', severity: 'warning', serviceIds: [mock.services[0].id], message: 'Looking', public: false });
      reliability.postIncidentUpdate(made.id, { status: 'identified', message: 'Found it', public: false });
      const saved = JSON.parse(JSON.stringify(reliability.incidentState())) as ReturnType<typeof reliability.incidentState>;

      reliability.restoreIncidentState(before);
      expect(reliability.incident(made.id)).toBeNull();

      reliability.restoreIncidentState(saved);
      const back = reliability.incident(made.id)!;
      expect(back.status).toBe('identified');
      expect(back.updates.map((u) => u.message)).toEqual(['Found it', 'Looking']);
      // Update ids keep counting, so a new update never collides with a restored one.
      const next = reliability.postIncidentUpdate(made.id, { status: 'monitoring', message: 'Watching', public: false });
      expect(new Set(next.updates.map((u) => u.id)).size).toBe(next.updates.length);
    } finally {
      reliability.restoreIncidentState(before);
    }
  });
});
