import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { Store } from '../store.js';
import { businessData, buckets, finVaultBusiness, nexusInfraPayments, overviewMoney } from './business.js';
import { createCtx } from './ctx.js';
import { finVault, nexusInfra, overview } from './pages.js';

const HOUR = 3_600_000;
// 25 Nov 2026, 14:30 UTC
const NOW = Date.UTC(2026, 10, 25, 14, 30);
let seq = 0;

function setup() {
  const store = new Store();
  const ctx = createCtx(store, loadConfig({ NW_RABBITMQ_URL: 'amqp://x' }), { clock: () => NOW });
  // The collector has been listening for two days.
  ctx.startedAt = NOW - 48 * HOUR;
  const add = (type: string, hoursAgo: number, data: Record<string, unknown>) =>
    store.addEvent({ id: `e${seq++}`, ts: NOW - hoursAgo * HOUR, routingKey: `events.${type}`, type, source: 'test', data });
  return { store, ctx, add };
}

describe('business views from bus events', () => {
  it('counts top-ups and confirmed money, and ignores payments that are not top-ups', () => {
    const { ctx, add } = setup();
    add('payment.request', 2, { reference: 'topup-u1-a', senderWalletId: 'u1', amount: 25, customerEmail: 't***@e***.com' });
    add('payment.confirmed', 1.9, { reference: 'topup-u1-a', amount: 25 });
    add('payment.request', 1, { reference: 'topup-u2-b', senderWalletId: 'u2', amount: 10 });
    add('payment.failed', 0.9, { reference: 'topup-u2-b', reason: 'declined' });
    add('payment.request', 0.5, { reference: 'topup-u3-c', senderWalletId: 'u3', amount: 5 });
    add('payment.confirmed', 0.4, { reference: 'TX-ABC', amount: 999, senderWalletId: 'w9' });
    add('payment.request', 30, { reference: 'topup-u1-old', senderWalletId: 'u1', amount: 40 });
    add('payment.confirmed', 29, { reference: 'topup-u1-old', amount: 40 });

    const m = overviewMoney(ctx);
    expect(m.topupsToday).toBe(3);
    expect(m.paymentsMonthEur).toBe(65);
    // Listening since 23 Nov 14:30: three UTC days, the last holding today's €25.
    expect(m.paymentsPerDay).toEqual([0, 40, 25]);
    expect(m.topupsPerHour.at(-1)).toBe(1);

    const p = nexusInfraPayments(ctx);
    expect(p.payments.map((x) => [x.id, x.paid])).toEqual([['topup-u3-c', false], ['topup-u1-a', true], ['topup-u1-old', true]]);

    const fv = finVaultBusiness(ctx);
    expect(fv.kpis).toMatchObject({ topupsToday: 3, topupsTodayEur: 25, transfers: 1, transferSuccessPct: 100, openInvoices: null, fxConversions: null });
    expect(fv.funnel.map((f) => f.count)).toEqual([3, 2, 1]);
    expect(fv.security).toBeNull();
    expect(fv.transactions[0]).toMatchObject({ type: 'P2P', wallet: 'w9', state: 'succeeded' });
  });

  it('reports top-ups as facts: seen on the bus, FinVault answer, credits not observed', () => {
    const { ctx, add } = setup();
    add('payment.request', 2, { reference: 'topup-u1-a', senderWalletId: 'u1', amount: 25, customerEmail: 't***@e***.com' });
    add('payment.confirmed', 1.9, { reference: 'topup-u1-a', amount: 25 });
    add('payment.confirmed', 1.8, { reference: 'topup-u1-a', amount: 25 });
    const [t] = businessData(ctx).topUps;
    expect(t).toMatchObject({ reference: 'topup-u1-a', accountId: 'u1', payer: 't***@e***.com', sent: true, status: null, credits: null });
    expect(t.finvault).toMatchObject({ outcome: 'confirmed', amountEur: 25 });
    expect(businessData(ctx).topUpTimeoutMs).toBe(30 * 60_000);
  });

  it('lists suspended servers until they start again', () => {
    const { ctx, add } = setup();
    add('billing.server.suspend', 5, { userId: 'u1', deploymentIds: ['d1', 'd2'], reason: 'credit exhausted' });
    add('server.started', 1, { deploymentId: 'd1' });
    expect(businessData(ctx).suspended.map((s) => s.deploymentId)).toEqual(['d2']);
  });

  it('never pads before the collector was listening', () => {
    expect(buckets(10 * HOUR, HOUR, 24, 8 * HOUR, () => 0)).toHaveLength(3);
  });

  it('feeds the Overview, NexusInfra and FinVault pages when the bus is configured', () => {
    const { ctx, add } = setup();
    add('payment.request', 1, { reference: 'topup-u1-a', senderWalletId: 'u1', amount: 12 });
    add('payment.confirmed', 0.5, { reference: 'topup-u1-a', amount: 12 });
    expect(overview(ctx, '24h').kpis).toMatchObject({ topupsToday: 1, paymentsMonthEur: 12 });
    expect(nexusInfra(ctx).kpis.paymentsMonthEur).toBe(12);
    expect(nexusInfra(ctx).containers).toEqual([]);
    expect(finVault(ctx).kpis.topupsToday).toBe(1);
  });
});
