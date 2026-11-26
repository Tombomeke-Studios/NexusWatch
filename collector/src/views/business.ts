/**
 * Top-ups, payments, transfers and billing — built from the business events heard on the bus
 * (`sources/business.ts`). Only what the bus shows is reported; what it does not show (the bridge's
 * credit ledger, account standing, plans, wallet types, security) is null or empty, never invented.
 *
 * Definitions:
 * - a top-up is NexusInfra's `payment.request` with a `topup-…` reference (Billing Bridge, #298)
 * - FinVault's answer is `payment.confirmed` / `payment.failed` carrying that reference
 * - a payment to NexusInfra is a confirmed top-up: money that moved, counted on the day it was confirmed
 * - a transfer is any other `payment.confirmed` / `payment.failed` (FinVault's P2P and SEPA)
 * Days and hours are UTC, like every timestamp in the contract.
 */
import type { BusHealth, BusinessData, FinVaultData, Payment, SuspendedServer, TopUpRecord, Transaction } from '../contract.js';
import { THROUGHPUT_SERIES } from '../sources/business.js';
import type { BusEvent } from '../store.js';
import { iso, type Ctx } from './ctx.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const DLQ = 'finvault.events.dlq';

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isTopUp = (e: BusEvent) => str(e.data.reference)?.startsWith('topup-') ?? false;
const startOfDay = (ms: number) => Math.floor(ms / DAY) * DAY;
const startOfMonth = (ms: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

export interface TopUp {
  reference: string;
  accountId: string;
  payer: string | null;
  amountEur: number;
  requestedAt: number;
  answer: { outcome: 'confirmed' | 'failed'; at: number; amountEur: number; reason: string | null } | null;
}

/** Every top-up requested since `from`, oldest first, with FinVault's first answer if there is one. */
export function topUps(ctx: Ctx, from: number): TopUp[] {
  const answers = new Map<string, TopUp['answer']>();
  for (const e of ctx.store.events(['payment.confirmed', 'payment.failed'], from)) {
    const ref = str(e.data.reference);
    if (!ref || answers.has(ref)) continue;
    answers.set(ref, {
      outcome: e.type === 'payment.confirmed' ? 'confirmed' : 'failed',
      at: e.ts,
      amountEur: num(e.data.amount) ?? NaN,
      reason: str(e.data.reason),
    });
  }
  return ctx.store
    .events(['payment.request'], from)
    .filter(isTopUp)
    .map((e) => {
      const reference = str(e.data.reference) as string;
      const amountEur = num(e.data.amount) ?? 0;
      const answer = answers.get(reference) ?? null;
      // A confirmation without an amount confirms the amount asked (FinVault always sends one).
      return {
        reference,
        accountId: str(e.data.senderWalletId) ?? str(e.data.userId) ?? 'unknown',
        payer: str(e.data.customerEmail),
        amountEur,
        requestedAt: e.ts,
        answer: answer && Number.isNaN(answer.amountEur) ? { ...answer, amountEur } : answer,
      };
    });
}

/**
 * When the collector started listening: the first stored business event or this run's start,
 * whichever is earlier. Buckets before it are left out (a live series is never padded).
 */
export function observedSince(ctx: Ctx): number {
  const first = ctx.store.firstEventAt();
  return first === null ? ctx.startedAt : Math.min(first, ctx.startedAt);
}

/** Values per bucket of `size` ms over the last `count` buckets ending now, oldest first, from `since` on. */
export function buckets(now: number, size: number, count: number, since: number, add: (bucketStart: number) => number): number[] {
  const end = Math.floor(now / size) * size;
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = end - i * size;
    if (start + size <= since) continue;
    out.push(add(start));
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Top-up requests per hour, last 24 hours. */
function perHour(ctx: Ctx, list: TopUp[], now: number): number[] {
  return buckets(now, HOUR, 24, observedSince(ctx), (s) => list.filter((t) => t.requestedAt >= s && t.requestedAt < s + HOUR).length);
}

/** Confirmed top-up money per day, last 30 days. */
function paidPerDay(ctx: Ctx, list: TopUp[], now: number): number[] {
  return buckets(now, DAY, 30, observedSince(ctx), (s) =>
    round2(list.filter((t) => t.answer?.outcome === 'confirmed' && t.answer.at >= s && t.answer.at < s + DAY).reduce((sum, t) => sum + t.answer!.amountEur, 0)),
  );
}

const confirmedSince = (list: TopUp[], from: number) =>
  round2(list.filter((t) => t.answer?.outcome === 'confirmed' && t.answer.at >= from).reduce((sum, t) => sum + t.answer!.amountEur, 0));

/** The Overview's two money tiles. */
export function overviewMoney(ctx: Ctx) {
  const now = ctx.clock();
  const list = topUps(ctx, Math.min(now - 31 * DAY, startOfMonth(now)));
  const hourly = perHour(ctx, list, now);
  const daily = paidPerDay(ctx, list, now);
  return {
    topupsToday: list.filter((t) => t.requestedAt >= startOfDay(now)).length,
    topupsTrend: hourly,
    paymentsMonthEur: confirmedSince(list, startOfMonth(now)),
    paymentsTrend: daily,
    topupsPerHour: hourly,
    paymentsPerDay: daily,
  };
}

/** NexusInfra's payments: confirmed and still-open top-ups, newest first (failed ones paid nothing). */
export function nexusInfraPayments(ctx: Ctx): { paymentsMonthEur: number; paymentsPerDay: number[]; payments: Payment[] } {
  const now = ctx.clock();
  const list = topUps(ctx, Math.min(now - 31 * DAY, startOfMonth(now)));
  return {
    paymentsMonthEur: confirmedSince(list, startOfMonth(now)),
    paymentsPerDay: paidPerDay(ctx, list, now),
    payments: list
      .filter((t) => t.answer?.outcome !== 'failed')
      .reverse()
      .slice(0, 8)
      .map((t) => ({ id: t.reference, server: 'credit top-up', user: `account ${t.accountId}`, when: iso(t.answer?.at ?? t.requestedAt), amountEur: t.amountEur, paid: t.answer?.outcome === 'confirmed' })),
  };
}

const eur = (n: number) => `€${n.toFixed(2)}`;
const transferType = (ref: string): Transaction['type'] => (ref.startsWith('topup-') ? 'top-up' : ref.startsWith('TX-') ? 'P2P' : 'SEPA');

/** Everything on the FinVault page that the bus can tell; `base` supplies the services part. */
export function finVaultBusiness(ctx: Ctx): Omit<FinVaultData, 'services'> {
  const now = ctx.clock();
  const today = startOfDay(now);
  const list = topUps(ctx, now - 2 * DAY);
  const todays = list.filter((t) => t.requestedAt >= today);
  const yesterday = list.filter((t) => t.requestedAt >= today - DAY && t.requestedAt < today).length;
  const measuredYesterday = observedSince(ctx) <= today - DAY;
  const delta = !measuredYesterday ? 'not measured yesterday' : yesterday === 0 ? `${todays.length ? '+' : ''}${todays.length} vs none yesterday` : `${todays.length >= yesterday ? '+' : ''}${Math.round(((todays.length - yesterday) / yesterday) * 100)}% vs yesterday`;

  const answers = ctx.store.events(['payment.confirmed', 'payment.failed'], today);
  const transfers = answers.filter((e) => !isTopUp(e));
  const transfersOk = transfers.filter((e) => e.type === 'payment.confirmed').length;
  const wallets = new Set(ctx.store.events(['balance.updated'], now - DAY).map((e) => str(e.data.walletId)).filter(Boolean));

  const recent = ctx.store.events(['payment.confirmed', 'payment.failed', 'payment.request'], now - DAY).reverse();
  // FinVault's answer names FinVault wallets; a top-up is shown under the NexusInfra account that asked.
  const accountOf = new Map(list.map((t) => [t.reference, t.accountId]));
  const seenRefs = new Set<string>();
  const transactions: Transaction[] = [];
  for (const e of recent) {
    const ref = str(e.data.reference);
    if (!ref || seenRefs.has(ref)) continue;
    // A request only shows while it has no answer; FinVault's own requests are not top-ups.
    if (e.type === 'payment.request' && !isTopUp(e)) continue;
    seenRefs.add(ref);
    const type = transferType(ref);
    const amount = num(e.data.amount);
    const wallet = (type === 'top-up' ? accountOf.get(ref) : undefined) ?? str(e.data.senderWalletId) ?? '—';
    transactions.push({
      id: e.id,
      time: iso(e.ts),
      type,
      wallet,
      amount: amount === null ? '—' : `${type === 'top-up' ? '+' : '-'} ${eur(amount)}`,
      incoming: type === 'top-up',
      state: e.type === 'payment.confirmed' ? 'succeeded' : e.type === 'payment.failed' ? 'failed' : 'pending',
    });
    if (transactions.length >= 12) break;
  }

  return {
    kpis: {
      topupsToday: todays.length,
      topupsTodayEur: confirmedSince(todays, today),
      topupsDelta: delta,
      activeWallets: wallets.size,
      transfers: transfers.length,
      transferSuccessPct: transfers.length ? (transfersOk / transfers.length) * 100 : null,
      openInvoices: null,
      openInvoicesNote: 'not on the bus',
      fxConversions: null,
      fxNote: 'not on the bus',
    },
    funnel: [
      { label: 'Requested', count: todays.length, color: 'sky' },
      { label: 'Answered by FinVault', count: todays.filter((t) => t.answer).length, color: 'vi' },
      { label: 'Confirmed by FinVault', count: todays.filter((t) => t.answer?.outcome === 'confirmed').length, color: 'fv' },
    ],
    topupsPerHour: perHour(ctx, list, now),
    walletSplit: [],
    queues: [],
    transactions,
    security: null,
  };
}

/** Servers stopped by `billing.server.suspend` and not started again since. */
function suspended(ctx: Ctx, now: number): SuspendedServer[] {
  const from = now - 90 * DAY;
  const started = new Map<string, number>();
  for (const e of ctx.store.events(['server.started'], from)) {
    const id = str(e.data.deploymentId);
    if (id) started.set(id, e.ts);
  }
  const out = new Map<string, SuspendedServer>();
  for (const e of ctx.store.events(['billing.server.suspend'], from)) {
    const ids = Array.isArray(e.data.deploymentIds) ? e.data.deploymentIds.filter((d): d is string => typeof d === 'string') : [];
    for (const id of ids) {
      if ((started.get(id) ?? 0) > e.ts) continue;
      out.set(id, { deploymentId: id, accountId: str(e.data.userId) ?? 'unknown', suspendedAt: iso(e.ts), reason: str(e.data.reason) ?? 'credit exhausted' });
    }
  }
  return [...out.values()].sort((a, b) => b.suspendedAt.localeCompare(a.suspendedAt));
}

function bus(ctx: Ctx, now: number): BusHealth {
  const throughput = ctx.store.samples('bus_messages', now - HOUR, now).filter((s) => s.series === THROUGHPUT_SERIES).map((s) => s.value);
  const queues = ctx.store.latestSamples('queues');
  const dlq = queues.find((s) => s.series === 'dead-letters');
  return {
    exchange: 'finvault.events',
    throughputPerMin: throughput,
    dlq: dlq
      ? { name: DLQ, depth: dlq.value, error: null, checkedAt: iso(dlq.ts) }
      : { name: DLQ, depth: null, error: 'not measured — the Control Room scrape reports it', checkedAt: iso(now) },
    outboxes: queues.filter((s) => s.series.startsWith('outbox ')).map((s) => ({ service: s.series.slice('outbox '.length), pending: s.value, dropped: null })),
    queues: [],
  };
}

/** The Business page from the bus. Accounts and revenue per plan live only in the bridge's database. */
export function businessData(ctx: Ctx): BusinessData {
  const now = ctx.clock();
  const records: TopUpRecord[] = topUps(ctx, now - 7 * DAY)
    .reverse()
    .map((t) => ({
      reference: t.reference,
      accountId: t.accountId,
      payer: t.payer,
      amountEur: t.amountEur,
      requestedAt: iso(t.requestedAt),
      // Seen on the bus, so the broker took it.
      sent: true,
      status: null,
      expiredAt: null,
      finvault: t.answer ? { outcome: t.answer.outcome, at: iso(t.answer.at), amountEur: t.answer.amountEur, reason: t.answer.reason } : null,
      credits: null,
    }));
  return {
    topUpTimeoutMs: ctx.config.business.topUpTimeoutMs,
    lowCreditHours: ctx.config.business.lowCreditHours,
    topUps: records,
    accounts: [],
    suspended: suspended(ctx, now),
    revenueByPlan: [],
    bus: bus(ctx, now),
  };
}
