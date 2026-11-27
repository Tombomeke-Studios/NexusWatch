import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { addMonitor, isPaused, pauseMonitor, removeMonitor, storedMonitors } from './monitors.js';
import { Scheduler } from './sources/scheduler.js';
import { Store } from './store.js';
import { createCtx } from './views/ctx.js';
import { monitors, serviceDetail } from './views/services.js';

const ENV_TARGET = [{ id: 'fv-dashboard', name: 'FinVault Web Dashboard', project: 'finvault', url: 'http://host.docker.internal:3000' }];

function setup(env: Record<string, string> = { NW_HEALTH_TARGETS: JSON.stringify(ENV_TARGET) }) {
  const store = new Store();
  const ctx = createCtx(store, loadConfig(env), { clock: () => 0 });
  const scheduled: string[] = [];
  ctx.monitors = { scheduled: (t) => scheduled.push(t.id), unscheduled: (id) => scheduled.push(`-${id}`) };
  return { store, ctx, scheduled };
}

describe('monitors from the dashboard', () => {
  it('adds a monitor to every list, schedules it and keeps it across a restart', () => {
    const { store, ctx, scheduled } = setup();
    const t = addMonitor(ctx, { name: 'FinVault Gateway', project: 'finvault', url: 'http://finvault-gateway:8000/health', intervalSeconds: 60 });
    expect(t).toMatchObject({ id: 'm-finvault-gateway', port: ':8000', intervalMs: 60_000, source: 'dashboard', timeoutMs: 5_000 });
    expect(scheduled).toEqual(['m-finvault-gateway']);
    expect(monitors(ctx).map((m) => [m.serviceId, m.source])).toEqual([['fv-dashboard', 'env'], ['m-finvault-gateway', 'dashboard']]);
    expect(serviceDetail(ctx, 'm-finvault-gateway')).toMatchObject({ source: 'dashboard', paused: false, intervalSeconds: 60 });
    expect(storedMonitors(store, 5_000).map((m) => m.id)).toEqual(['m-finvault-gateway']);
  });

  it('refuses bad input (422), and removing a monitor from NW_HEALTH_TARGETS (409)', () => {
    const { ctx } = setup();
    expect(() => addMonitor(ctx, { name: 'x', project: 'finvault', url: 'http://127.0.0.1:9/' })).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => removeMonitor(ctx, 'fv-dashboard')).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => removeMonitor(ctx, 'nope')).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('removes a dashboard monitor and stops its checks', () => {
    const { ctx, scheduled } = setup();
    const t = addMonitor(ctx, { name: 'Temp', project: 'nexusinfra', url: 'http://example.org/' });
    removeMonitor(ctx, t.id);
    expect(scheduled).toEqual([t.id, `-${t.id}`]);
    expect(monitors(ctx).map((m) => m.serviceId)).toEqual(['fv-dashboard']);
  });

  it('pauses any monitor, also one from NW_HEALTH_TARGETS', () => {
    const { store, ctx } = setup();
    pauseMonitor(ctx, 'fv-dashboard', { paused: true });
    expect(isPaused(store, 'fv-dashboard')).toBe(true);
    expect(monitors(ctx)[0].paused).toBe(true);
    pauseMonitor(ctx, 'fv-dashboard', { paused: false });
    expect(isPaused(store, 'fv-dashboard')).toBe(false);
    expect(() => pauseMonitor(ctx, 'fv-dashboard', { paused: 'yes' })).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('makes a collector that started without sources live with its first monitor', () => {
    const { ctx } = setup({});
    expect(ctx.live.logs).toBe(false);
    addMonitor(ctx, { name: 'First', project: 'nexusinfra', url: 'http://example.org/' });
    expect(ctx.live).toMatchObject({ logs: true, services: true });
  });
});

describe('Scheduler.add / remove', () => {
  it('runs an added task right away once started, and forgets a removed one', async () => {
    const runs: string[] = [];
    const s = new Scheduler([], () => 0);
    s.start();
    s.add({ name: 'x', intervalMs: 60_000, run: async () => void runs.push('x') });
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toEqual(['x']);
    expect(s.snapshot().map((t) => t.name)).toEqual(['x']);
    s.remove('x');
    expect(s.snapshot()).toEqual([]);
    s.stop();
  });
});
