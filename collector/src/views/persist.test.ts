import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import type * as C from '../contract.js';
import { reliability, sample } from '../sample.js';
import { createApp } from '../server.js';
import { Store } from '../store.js';
import { createCtx } from './ctx.js';
import { restoreState, saveState } from './persist.js';

/** One collector "process": a store on `path` plus the HTTP app. `stop()` is the shutdown. */
async function boot(path: string) {
  const store = new Store(path);
  const server = createApp(createCtx(store, loadConfig({}))).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = (p: string, method = 'GET', body?: unknown) =>
    fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return {
    store,
    call,
    json: async <T>(p: string, method = 'GET', body?: unknown) => (await (await call(p, method, body)).json()) as T,
    stop: async () => {
      await new Promise((r) => server.close(r));
      store.close();
    },
  };
}

describe('alerting and incident state survives a restart', () => {
  let dir: string;
  let path: string;
  // The sample modules are singletons; a "restart" resets them to what a fresh process would hold.
  const fresh = { alerting: sample.alertingState(), incidents: reliability.incidentState() };
  const restart = () => {
    sample.restoreAlertingState(fresh.alerting);
    reliability.restoreIncidentState(fresh.incidents);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nw-persist-'));
    path = join(dir, 'test.db');
  });
  afterEach(() => {
    restart();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps a created rule, a silence and a declared incident', async () => {
    let app = await boot(path);
    const { id, ...input } = (await app.json<C.AlertsData>('/alerts')).rules[0];
    void id;
    const rule = await app.json<C.AlertRule>('/alert-rules', 'POST', { ...input, name: 'Survives restarts' });
    expect((await app.call('/silences', 'POST', { kind: 'rule', targetId: rule.id, duration: '1h', reason: 'Testing persistence' })).status).toBe(200);
    const incident = await app.json<C.IncidentDetail>('/incidents', 'POST', {
      title: 'Persisted incident', severity: 'warning', serviceIds: ['fv-invoice-service'], message: 'Looking', public: false,
    });
    await app.stop();

    restart();
    app = await boot(path);
    const alerts = await app.json<C.AlertsData>('/alerts');
    expect(alerts.rules.find((r) => r.id === rule.id)?.name).toBe('Survives restarts');
    expect(alerts.silences.some((s) => s.targetId === rule.id)).toBe(true);
    expect((await app.json<C.IncidentDetail>(`/incidents/${incident.id}`)).title).toBe('Persisted incident');
    await app.stop();
  });

  it('keeps an acknowledgement with its note, and a deletion', async () => {
    let app = await boot(path);
    const before = await app.json<C.AlertsData>('/alerts');
    const alertId = before.active[0].id;
    const deleted = before.rules.at(-1)!.id;
    expect((await app.call(`/alerts/${alertId}/ack`, 'POST', { note: 'On it' })).status).toBe(204);
    expect((await app.call(`/alert-rules/${deleted}`, 'DELETE')).status).toBe(204);
    await app.stop();

    restart();
    app = await boot(path);
    const after = await app.json<C.AlertsData>('/alerts');
    const alert = after.active.find((a) => a.id === alertId)!;
    expect(alert.acknowledged).toBe(true);
    expect(alert.acknowledgedAt).not.toBeNull();
    expect(alert.notes.map((n) => n.text)).toContain('On it');
    expect(after.rules.some((r) => r.id === deleted)).toBe(false);
    await app.stop();
  });

  it('stores nothing until something is written, and nothing after a refused write', async () => {
    const app = await boot(path);
    await app.json('/alerts');
    await app.json('/incidents');
    expect((await app.call('/alert-rules/nope', 'DELETE')).status).toBe(404);
    expect((await app.call('/alerts/nope/ack', 'POST', {})).status).toBe(404);
    expect(app.store.get('state.alerting')).toBeUndefined();
    expect(app.store.get('state.incidents')).toBeUndefined();
    await app.stop();
  });

  it('starts from the defaults when the stored state is unreadable', () => {
    const store = new Store();
    store.set('state.alerting', { rules: 'not a list' });
    store.set('state.incidents', 42);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    restoreState(store);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    expect(sample.alerts().rules).toHaveLength(fresh.alerting.rules.length);
    expect(reliability.incidents().incidents).toHaveLength(fresh.incidents.incidents.length);
    saveState(store);
    expect(store.get<{ rules: unknown[] }>('state.alerting')?.rules).toHaveLength(fresh.alerting.rules.length);
    store.close();
  });
});
