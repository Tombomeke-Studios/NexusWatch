import { describe, expect, it } from 'vitest';
import { Store } from './store.js';

const T0 = Date.UTC(2026, 10, 5, 10, 0, 0);
const DAY = 86_400_000;

function withLogs(): Store {
  const s = new Store();
  s.addLog({ ts: T0 - 1000, level: 'error', service: 'invoice-service', serviceId: 'fv-invoice-service', project: 'finvault', node: 'node-01', message: 'healthcheck failed: ECONNREFUSED' });
  s.addLog({ ts: T0 - 2000, level: 'warn', service: 'rabbitmq', project: 'nexusinfra', node: 'node-03', message: 'queue 100%_full' });
  s.addLog({ ts: T0 - 3000, level: 'info', service: 'wallet-service', project: 'finvault', node: 'node-01', message: 'fx rate refreshed', fields: { rate: 1.08 } });
  return s;
}

describe('Store logs', () => {
  it('stores a stable id and returns the same line on every read', () => {
    const s = withLogs();
    const f = { from: T0 - DAY, to: T0 };
    const first = s.logs(f).map((l) => l.id);
    expect(new Set(first).size).toBe(3);
    expect(s.logs(f).map((l) => l.id)).toEqual(first);
    expect(s.logs({ ...f, serviceId: 'fv-invoice-service' })[0].id).toBe(first[0]);
  });

  it('keeps the full structured document in fields', () => {
    const [line] = withLogs().logs({ from: 0, to: T0, text: 'fx rate' });
    expect(line.fields).toMatchObject({ level: 'info', service: 'wallet-service', rate: 1.08 });
    expect(line.time).toBe(new Date(T0 - 3000).toISOString());
  });

  it('filters by level, project and literal text, newest first', () => {
    const s = withLogs();
    const all = { from: 0, to: T0 };
    expect(s.logs({ ...all, levels: ['error', 'warn'] }).map((l) => l.level)).toEqual(['error', 'warn']);
    expect(s.logs({ ...all, project: 'nexusinfra' })).toHaveLength(1);
    expect(s.logs({ ...all, text: '100%_' })).toHaveLength(1);
    expect(s.logs({ ...all, text: '%' })).toHaveLength(1);
    expect(s.countLogs({ ...all, project: 'finvault' })).toBe(2);
  });

  it('counts facets and a histogram', () => {
    const s = withLogs();
    const f = { from: T0 - 4000, to: T0, levels: ['error' as const] };
    // Level facets ignore the level filter, so the other levels stay clickable.
    expect(s.logFacet(f, 'level').map((x) => x.value).sort()).toEqual(['error', 'info', 'warn']);
    expect(s.logFacet(f, 'node')).toEqual([{ value: 'node-01', count: 1 }]);
    const h = s.logHistogram({ from: T0 - 4000, to: T0 }, 4);
    expect(h).toHaveLength(4);
    expect(h.reduce((a, b) => a + b.error + b.warn, 0)).toBe(2);
  });
});

describe('Store checks, samples, sources and incidents', () => {
  it('keeps a missing answer as null latency', () => {
    const s = new Store();
    s.addCheck('a', { ts: T0, status: 'down', latencyMs: null, note: 'timeout' });
    s.addCheck('a', { ts: T0 + 1, status: 'up', latencyMs: 12, note: '200' });
    expect(s.checks('a').map((c) => c.latencyMs)).toEqual([null, 12]);
    expect(s.lastChecks('a', 1)[0].status).toBe('up');
    expect(s.firstCheckAt('a')).toBe(T0);
    expect(s.firstCheckAt('b')).toBeNull();
  });

  it('ignores samples that are not numbers and returns the latest per series', () => {
    const s = new Store();
    s.addSample('cpu', 'node-01', T0, 10);
    s.addSample('cpu', 'node-01', T0 + 5, 20);
    s.addSample('cpu', 'node-02', T0, NaN);
    expect(s.samples('cpu', 0, T0 + 10)).toHaveLength(2);
    expect(s.latestSamples('cpu')).toEqual([{ series: 'node-01', ts: T0 + 5, value: 20 }]);
    expect(s.hasSamples('memory')).toBe(false);
  });

  it('merges source detail and keeps a known uptime when an update has none', () => {
    const s = new Store();
    s.upsertSource({ name: 'node-01', kind: 'node', status: 'up', lastSeen: T0, uptimePct: 99.5, origin: 'control-room', detail: { a: 1 } });
    s.upsertSource({ name: 'node-01', kind: 'node', status: 'slow', lastSeen: T0 + 1, uptimePct: null, origin: 'bus', detail: { b: 2 } });
    expect(s.source('node-01')).toMatchObject({ status: 'slow', uptimePct: 99.5, detail: { a: 1, b: 2 } });
    expect(s.sources('service')).toEqual([]);
  });

  it('opens and closes incidents per subject', () => {
    const s = new Store();
    s.openIncident({ subject: 'svc:a', project: 'finvault', severity: 'critical', title: 'a down', note: '', startedAt: T0 });
    expect(s.openIncidentFor('svc:a')).not.toBeNull();
    expect(s.closeIncidents('svc:a', T0 + 60_000)).toBe(1);
    expect(s.openIncidentFor('svc:a')).toBeNull();
    expect(s.incidents(0)[0].endedAt).toBe(T0 + 60_000);
  });
});

describe('Store retention and settings', () => {
  it('prunes each kind by its own retention and never an open incident', () => {
    const s = new Store();
    const now = T0 + 100 * DAY;
    s.addLog({ ts: T0, level: 'info', service: 'x', project: 'finvault', node: 'n', message: 'old' });
    s.addLog({ ts: now, level: 'info', service: 'x', project: 'finvault', node: 'n', message: 'new' });
    s.addSample('cpu', 'n', T0, 1);
    s.addCheck('a', { ts: T0, status: 'up', latencyMs: 1, note: '' });
    s.openIncident({ subject: 'svc:a', project: 'finvault', severity: 'critical', title: 'still down', note: '', startedAt: T0 });
    const removed = s.prune({ logs: 14 * DAY, metrics: 365 * DAY, heartbeats: 90 * DAY }, now);
    expect(removed).toEqual({ logs: 1, metrics: 0, heartbeats: 1 });
    expect(s.incidents(0)).toHaveLength(1);
  });

  it('round-trips key/value settings and reports usage', () => {
    const s = new Store();
    s.set('acks', ['al_1']);
    expect(s.get<string[]>('acks')).toEqual(['al_1']);
    expect(s.get('missing')).toBeUndefined();
    const u = s.usage();
    expect(u.fileBytes).toBeGreaterThan(0);
    expect(Object.keys(u.perKind).sort()).toEqual(['heartbeats', 'logs', 'metrics']);
  });
});
