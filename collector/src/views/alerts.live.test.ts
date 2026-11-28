import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { sample } from '../sample.js';
import { Store } from '../store.js';
import { acknowledge, alerts, resolveLive } from './alerts.js';
import { createCtx } from './ctx.js';

const TARGETS = [{ id: 'fv-gw', name: 'FinVault gateway', project: 'finvault', url: 'http://fv:8000/health' }];

function setup() {
  let now = Date.UTC(2026, 10, 27, 12);
  const store = new Store();
  const ctx = createCtx(store, loadConfig({ NW_HEALTH_TARGETS: JSON.stringify(TARGETS) }), { clock: () => now });
  const incident = store.openIncident({ subject: 'service:fv-gw', project: 'finvault', severity: 'critical', title: 'FinVault gateway is not responding', note: 'ECONNREFUSED', startedAt: now - 60_000 });
  return { store, ctx, incident, tick: (ms: number) => (now += ms) };
}

describe('live alerts', () => {
  it('keeps when an alert was acknowledged and the note, once', () => {
    const { ctx, incident, tick } = setup();
    acknowledge(ctx, incident.id, 'Looking into it');
    tick(5_000);
    acknowledge(ctx, incident.id, 'second time is ignored');
    const [a] = alerts(ctx).active;
    expect(a).toMatchObject({ acknowledged: true, acknowledgedAt: expect.any(String) });
    expect(a.notes.map((n) => [n.kind, n.text])).toEqual([['acknowledged', 'Looking into it']]);
    expect(() => acknowledge(ctx, 'nope')).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('resolves an alert by closing its incident, and keeps the note in history', () => {
    const { ctx, incident } = setup();
    resolveLive(ctx, incident.id, 'Restarted the gateway');
    const data = alerts(ctx);
    expect(data.active).toEqual([]);
    expect(data.history[0]).toMatchObject({ open: false, notes: [{ kind: 'resolved', text: 'Restarted the gateway' }] });
    expect(() => resolveLive(ctx, incident.id)).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('mutes one live alert until it resolves, then drops the silence', () => {
    const { store, ctx, incident, tick } = setup();
    const open = [{ id: incident.id, title: incident.title, ruleId: 'r2' }];
    const silence = sample.createSilence({ kind: 'alert', targetId: incident.id, duration: 'resolved', reason: 'Known, fixing it' }, open);
    expect(alerts(ctx).active[0].silenceId).toBe(silence.id);
    expect(() => sample.createSilence({ kind: 'alert', targetId: 'nope', duration: '1h', reason: 'x' }, open)).toThrow(expect.objectContaining({ status: 404 }));

    store.closeIncidents('service:fv-gw', tick(1_000));
    expect(alerts(ctx).silences.some((s) => s.id === silence.id)).toBe(false);
  });
});
