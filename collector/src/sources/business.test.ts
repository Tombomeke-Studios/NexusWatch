import { describe, expect, it } from 'vitest';
import { Store } from '../store.js';
import { HeartbeatConsumer, type BusChannel } from './bus.js';
import { BUSINESS_BINDINGS, BusinessRecorder, THROUGHPUT_SERIES, keptFields } from './business.js';

const T0 = Date.UTC(2026, 10, 25, 10);
const msg = (eventId: string, type: string, payload: object, at = T0) =>
  Buffer.from(JSON.stringify({ eventId, timestamp: new Date(at).toISOString(), source: 'test', event: { type, payload } }));

describe('keptFields', () => {
  it('keeps ids and amounts, masks emails and drops free text', () => {
    expect(
      keptFields({ reference: 'topup-u1-x', amount: 25, customerEmail: 'tom@example.com', description: 'rent for march', iban: 'BE71…', reason: 'x'.repeat(500) }),
    ).toEqual({ reference: 'topup-u1-x', amount: 25, customerEmail: 't***@e***.com', reason: 'x'.repeat(200) });
  });
});

describe('BusinessRecorder via the bus consumer', () => {
  it('stores business events once, and never heartbeats', () => {
    const store = new Store();
    const c = new HeartbeatConsumer(store, () => T0 + 1000, undefined, new BusinessRecorder(store));
    c.handle('bank.payment.request', msg('e1', 'payment.request', { reference: 'topup-u1-a', senderWalletId: 'u1', amount: 25, currency: 'EUR' }));
    c.handle('bank.payment.request', msg('e1', 'payment.request', { reference: 'topup-u1-a', senderWalletId: 'u1', amount: 25, currency: 'EUR' }));
    c.handle('monitoring.heartbeat.service.gateway', msg('e2', 'heartbeat.service', { name: 'gateway' }));
    const events = store.events(['payment.request', 'heartbeat.service']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'e1', ts: T0, routingKey: 'bank.payment.request', data: { reference: 'topup-u1-a', amount: 25 } });
  });

  it('counts every message per minute and stores the count when the minute is over', () => {
    const store = new Store();
    const r = new BusinessRecorder(store);
    r.heard(T0 + 1000);
    r.heard(T0 + 2000);
    r.heard(T0 + 59_000);
    expect(store.hasSamples('bus_messages')).toBe(false);
    r.heard(T0 + 61_000);
    expect(store.latestSamples('bus_messages')).toEqual([{ series: THROUGHPUT_SERIES, ts: T0, value: 3 }]);
  });

  it('binds the business keys only when it records them', async () => {
    const bound: string[] = [];
    const channel: BusChannel = {
      checkExchange: async () => ({}),
      assertQueue: async (q) => ({ queue: q }),
      bindQueue: async (_q, _ex, key) => bound.push(key),
      consume: async () => ({}),
    };
    await new HeartbeatConsumer(new Store(), () => T0, undefined, new BusinessRecorder(new Store())).attach(channel, 'q');
    expect(bound).toEqual(['monitoring.heartbeat.#', ...BUSINESS_BINDINGS]);
    expect(BUSINESS_BINDINGS).not.toContain('#');
  });
});
