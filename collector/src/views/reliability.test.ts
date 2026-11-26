import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { Store } from '../store.js';
import { createCtx } from './ctx.js';
import { incidentLive, incidentsLive, slosLive, statusLive } from './reliability.js';
import { sample } from '../sample.js';

const NOW = Date.UTC(2026, 10, 25, 12);
const TARGETS = [{ id: 'nx-gw', name: 'NexusInfra Gateway', project: 'nexusinfra', url: 'http://10.0.0.5:9400/health' }];

function setup() {
  const store = new Store();
  for (let i = 0; i < 10; i++) store.addCheck('nx-gw', { ts: NOW - i * 60_000, status: i === 3 ? 'down' : 'up', latencyMs: i === 3 ? null : 20, note: '' });
  const ctx = createCtx(store, loadConfig({ NW_HEALTH_TARGETS: JSON.stringify(TARGETS) }), { clock: () => NOW });
  return { store, ctx };
}

describe('live reliability', () => {
  it('tallies each monitored service from its checks, with empty days before monitoring began', () => {
    const [slo] = slosLive(setup().ctx).slos;
    expect(slo).toMatchObject({ serviceId: 'nx-gw', targetPct: 99.5, window: { good: 9, bad: 1, unknown: 0 } });
    expect(slo.daily).toHaveLength(30);
    expect(slo.daily[0]).toEqual({ good: 0, bad: 0, unknown: 0 });
    expect(slo.burnWindows['5m'].good).toBeGreaterThan(0);
  });

  it("lists the collector's own incidents, and finds one by id", () => {
    const { store, ctx } = setup();
    const row = store.openIncident({ subject: 'service:nx-gw', project: 'nexusinfra', severity: 'critical', title: 'NexusInfra Gateway is not responding', note: 'ECONNREFUSED', startedAt: NOW - 60_000 });
    const list = incidentsLive(ctx);
    expect(list.incidents.map((i) => i.id)).toContain(row.id);
    expect(list.summary.open).toBeGreaterThanOrEqual(1);
    expect(incidentLive(ctx, row.id)).toMatchObject({ status: 'investigating', public: false, affected: [{ serviceId: 'nx-gw', name: 'NexusInfra Gateway' }] });
    // The seeded sample incidents are gone in live mode: only the collector's own is listed.
    expect(list.incidents.map((i) => i.id)).toEqual([row.id]);
  });

  it('builds /status from the monitored services without hosts, ports or ids', () => {
    const page = statusLive(setup().ctx);
    expect(page.groups.map((g) => g.components.map((c) => c.name))).toEqual([['NexusInfra Gateway']]);
    expect(page.groups[0].components[0].days).toHaveLength(90);
    const text = JSON.stringify(page);
    for (const secret of ['10.0.0.5', '9400', 'nx-gw']) expect(text).not.toContain(secret);
    expect(page.active).toEqual([]);
  });

  it('drops the seeded silences and maintenance windows in live mode', () => {
    setup();
    expect(sample.alerts().silences).toEqual([]);
    expect(sample.alerts().maintenance).toEqual([]);
    expect(sample.alerts().rules.every((r) => !r.runbookUrl.includes('home.example'))).toBe(true);
  });
});
