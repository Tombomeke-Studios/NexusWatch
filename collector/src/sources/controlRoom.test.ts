import { describe, expect, it } from 'vitest';
import { Store } from '../store.js';
import { pollControlRoom } from './controlRoom.js';
import type { Fetch } from './types.js';

const T0 = Date.UTC(2026, 10, 5, 10);
const opts = { url: 'http://cr:9000', intervalMs: 10_000, nodePattern: /^node-/ };

function controlRoom(monitored: object[], deadLetters: object): Fetch {
  return async (url) => {
    if (url.endsWith('/status')) return Response.json({ monitored, thresholds: { degradedMs: 3000, offlineMs: 10000 }, deadLetters });
    if (url.endsWith('/uptime')) return Response.json({ sources: [{ source: 'node-pi', firstSeen: T0 - 1000, observedMs: 1000, healthyMs: 900, transitions: [] }] });
    return new Response('', { status: 404 });
  };
}

describe('pollControlRoom', () => {
  it('records nodes and services with their status and uptime', async () => {
    const store = new Store();
    await pollControlRoom(
      opts,
      store,
      controlRoom(
        [
          { source: 'node-pi', status: 'healthy', lastSeenMsAgo: 400, uptimePercent: 99.2 },
          { source: 'orchestrator', status: 'degraded', lastSeenMsAgo: 4000, uptimePercent: 97 },
        ],
        { status: 'messages-waiting', depth: 3 },
      ),
      () => T0,
    );
    expect(store.source('node-pi')).toMatchObject({ kind: 'node', status: 'up', lastSeen: T0 - 400, uptimePct: 99.2, detail: { healthyMs: 900 } });
    expect(store.source('orchestrator')).toMatchObject({ kind: 'service', status: 'slow' });
    expect(store.latestSamples('queues')).toEqual([{ series: 'dead-letters', ts: T0, value: 3 }]);
  });

  it('does not store an unknown dead-letter depth as zero', async () => {
    const store = new Store();
    await pollControlRoom(opts, store, controlRoom([], { status: 'unknown', depth: null, error: 'not connected' }), () => T0);
    expect(store.hasSamples('queues')).toBe(false);
  });

  it('opens an incident when a source goes offline and closes it when it is back', async () => {
    const store = new Store();
    const beat = (status: string) => controlRoom([{ source: 'node-pi', status, lastSeenMsAgo: status === 'offline' ? 15_000 : 100, uptimePercent: 90 }], {});
    await pollControlRoom(opts, store, beat('healthy'), () => T0);
    await pollControlRoom(opts, store, beat('offline'), () => T0 + 20_000);
    expect(store.openIncidentFor('source:node-pi')).toMatchObject({ severity: 'critical', startedAt: T0 + 5_000 });
    await pollControlRoom(opts, store, beat('healthy'), () => T0 + 40_000);
    expect(store.openIncidentFor('source:node-pi')).toBeNull();
    expect(store.logs({ from: 0, to: T0 + 50_000 }).map((l) => l.level)).toEqual(['ok', 'error', 'info']);
  });

  it('fails the poll when /status does not answer', async () => {
    await expect(pollControlRoom(opts, new Store(), async () => new Response('', { status: 502 }), () => T0)).rejects.toThrow(/502/);
  });
});
