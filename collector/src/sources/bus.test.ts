import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Store } from '../store.js';
import { BINDING, EXCHANGE, HeartbeatConsumer, type BusChannel } from './bus.js';
import { evaluateBusSources, liveSources } from './heartbeat.js';
import { KDF_SALT } from './payload.js';

const KEY = 'bus-test-key';
const T0 = Date.UTC(2026, 10, 5, 10);

function encrypt(payload: object): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', scryptSync(KEY, KDF_SALT, 32), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(payload)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

const message = (source: string, type: string, payload: object) =>
  Buffer.from(JSON.stringify({ eventId: 'e1', timestamp: new Date(T0).toISOString(), source, event: { type, payload } }));

describe('HeartbeatConsumer', () => {
  it('records a node heartbeat with its resources as samples', () => {
    const store = new Store();
    const c = new HeartbeatConsumer(store, () => T0, undefined);
    c.handle(
      'monitoring.heartbeat.node.node-pi',
      message('node-agent:node-pi', 'heartbeat.node', {
        nodeId: 'node-pi', status: 'healthy', timestamp: '', agentUrl: 'http://192.168.1.30:9100',
        resources: { cpuPercent: 38, ramUsedMb: 2048, ramTotalMb: 8192 },
      }),
    );
    expect(store.source('node-pi')).toMatchObject({ kind: 'node', status: 'up', origin: 'bus', detail: { host: '192.168.1.30' } });
    expect(store.latestSamples('cpu')[0].value).toBe(38);
    expect(store.latestSamples('memory')[0].value).toBe(25);
    // The agent did not measure its disk: nothing is stored, rather than a 0.
    expect(store.hasSamples('disk')).toBe(false);
  });

  it('reads encrypted service heartbeats with the shared key', () => {
    const store = new Store();
    new HeartbeatConsumer(store, () => T0, KEY).handle(
      'monitoring.heartbeat.service.orchestrator',
      message('orchestrator', 'heartbeat.service', { encrypted: true, data: encrypt({ name: 'orchestrator', status: 'healthy' }) }),
    );
    expect(store.source('orchestrator')?.kind).toBe('service');
  });

  it('logs an unreadable payload once, not on every message', () => {
    const store = new Store();
    const c = new HeartbeatConsumer(store, () => T0, 'wrong-key');
    const msg = message('orchestrator', 'heartbeat.service', { encrypted: true, data: encrypt({ name: 'orchestrator' }) });
    c.handle('monitoring.heartbeat.service.orchestrator', msg);
    c.handle('monitoring.heartbeat.service.orchestrator', msg);
    c.handle('x', Buffer.from('not json'));
    const warns = store.logs({ from: 0, to: T0 + 1, levels: ['warn'] });
    expect(warns).toHaveLength(2);
    expect(warns.some((w) => w.message.includes('differs from the sender'))).toBe(true);
    expect(store.sources()).toEqual([]);
  });

  it('ages bus sources by the clock and opens an incident when one goes quiet', () => {
    const store = new Store();
    new HeartbeatConsumer(store, () => T0, undefined).handle('k', message('node-agent:node-pi', 'heartbeat.node', { nodeId: 'node-pi' }));
    expect(liveSources(store, 'node', T0 + 4000)[0].status).toBe('slow');
    evaluateBusSources(store, T0 + 12_000);
    expect(store.source('node-pi')?.status).toBe('down');
    expect(store.openIncidentFor('source:node-pi')?.title).toBe('node node-pi offline');
  });

  it('checks the exchange instead of declaring it, and binds its own throwaway queue', async () => {
    const calls: string[] = [];
    const channel: BusChannel = {
      checkExchange: async (name) => calls.push(`check ${name}`),
      assertQueue: async (name, o) => {
        calls.push(`queue ${name} exclusive=${o.exclusive} autoDelete=${o.autoDelete}`);
        return { queue: name };
      },
      bindQueue: async (q, ex, key) => calls.push(`bind ${q} ${ex} ${key}`),
      consume: async (q) => calls.push(`consume ${q}`),
    };
    await new HeartbeatConsumer(new Store(), () => T0).attach(channel, 'nexuswatch.collector');
    expect(EXCHANGE).toBe('finvault.events');
    expect(calls).toEqual([
      'check finvault.events',
      'queue nexuswatch.collector exclusive=true autoDelete=true',
      `bind nexuswatch.collector finvault.events ${BINDING}`,
      'consume nexuswatch.collector',
    ]);
  });
});
