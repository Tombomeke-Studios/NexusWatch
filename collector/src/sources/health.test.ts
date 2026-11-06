import { describe, expect, it } from 'vitest';
import type { HealthTarget } from '../config.js';
import { Store } from '../store.js';
import { checkOnce, runHealthCheck, trailingFailures } from './health.js';
import type { Fetch } from './types.js';

const target: HealthTarget = { id: 'fv-invoice-service', name: 'invoice-service', project: 'finvault', url: 'http://invoice:8003/health', port: ':8003', intervalMs: 30_000, timeoutMs: 5_000 };
const opts = { slowMs: 100, failuresForIncident: 3 };

/** A fake clock that the fake fetch advances by `latency` ms, so latency is deterministic. */
function rig() {
  let now = Date.UTC(2026, 10, 5, 10, 0, 0);
  const clock = () => now;
  const answer = (latency: number, res: () => Response): Fetch => async () => {
    now += latency;
    return res();
  };
  const fail = (latency: number, err: Error): Fetch => async () => {
    now += latency;
    throw err;
  };
  const tick = (ms: number) => (now += ms);
  return { clock, answer, fail, tick };
}

const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });

describe('checkOnce', () => {
  it('marks a quick 2xx up and measures latency', async () => {
    const { clock, answer } = rig();
    const c = await checkOnce(target, answer(42, () => new Response('{"status":"healthy"}')), clock, 100);
    expect(c).toMatchObject({ status: 'up', latencyMs: 42 });
  });

  it('marks a slow or degraded answer slow', async () => {
    const { clock, answer } = rig();
    expect((await checkOnce(target, answer(140, () => new Response('ok')), clock, 100)).status).toBe('slow');
    expect((await checkOnce(target, answer(5, () => new Response('{"status":"degraded"}')), clock, 100)).status).toBe('slow');
  });

  it('stores null latency, never 0, when there is no good answer', async () => {
    const { clock, answer, fail } = rig();
    const http = await checkOnce(target, answer(3, () => new Response('', { status: 503, statusText: 'Service Unavailable' })), clock, 100);
    expect(http).toMatchObject({ status: 'down', latencyMs: null, note: 'HTTP 503 Service Unavailable' });
    const conn = await checkOnce(target, fail(1, refused), clock, 100);
    expect(conn).toMatchObject({ status: 'down', latencyMs: null });
    expect(conn.note).toContain('ECONNREFUSED');
    const timeout = await checkOnce(target, fail(5000, Object.assign(new Error('aborted'), { name: 'TimeoutError' })), clock, 100);
    expect(timeout).toMatchObject({ status: 'down', latencyMs: null, note: 'timed out after 5 s' });
  });
});

describe('runHealthCheck', () => {
  it('logs failures, opens an incident on the third and closes it on recovery', async () => {
    const store = new Store();
    const { clock, answer, fail, tick } = rig();
    await runHealthCheck(target, store, answer(20, () => new Response('ok')), clock, opts);
    for (let i = 0; i < 3; i++) {
      tick(30_000);
      await runHealthCheck(target, store, fail(1, refused), clock, opts);
    }
    expect(trailingFailures(store.checks(target.id))).toBe(3);
    const open = store.openIncidentFor(`service:${target.id}`);
    expect(open?.title).toBe('invoice-service is not responding');
    // The incident starts at the first failure, not at the one that crossed the threshold.
    expect(open?.startedAt).toBe(store.checks(target.id)[1].ts);

    tick(30_000);
    await runHealthCheck(target, store, answer(30, () => new Response('ok')), clock, opts);
    expect(store.openIncidentFor(`service:${target.id}`)).toBeNull();

    const lines = store.logs({ from: 0, to: clock() + 1 }).reverse();
    expect(lines.map((l) => l.level)).toEqual(['info', 'error', 'error', 'error', 'ok', 'ok']);
    expect(lines[3].fields.consecutiveFailures).toBe(3);
    expect(lines.every((l) => l.serviceId === target.id && l.project === 'finvault')).toBe(true);
  });

  it('writes one warn line when a service turns slow, not one per check', async () => {
    const store = new Store();
    const { clock, answer, tick } = rig();
    await runHealthCheck(target, store, answer(20, () => new Response('ok')), clock, opts);
    tick(30_000);
    await runHealthCheck(target, store, answer(150, () => new Response('ok')), clock, opts);
    tick(30_000);
    await runHealthCheck(target, store, answer(160, () => new Response('ok')), clock, opts);
    expect(store.logs({ from: 0, to: clock() + 1, levels: ['warn'] })).toHaveLength(1);
  });
});
