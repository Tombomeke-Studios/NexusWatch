/**
 * Business events from the shared `finvault.events` exchange: the facts behind top-ups, payments and
 * billing, as NexusInfra and FinVault publish them.
 *
 * - NexusInfra's Billing Bridge: `bank.payment.request` (a top-up, reference `topup-<user>-<uuid>`),
 *   `billing.credit.low`, `billing.server.suspend`, `billing.invoice.*`
 * - FinVault's gateway re-publishes every FinVault event as `events.<type>`: `payment.confirmed` /
 *   `payment.failed` (the answer to a top-up, and every P2P / SEPA transfer), `balance.updated`, …
 * - NexusInfra's `infra.#`: deployments and servers starting and stopping
 *
 * Only facts are kept, and only a known set of fields (ids, amounts, times): free text such as a
 * transfer's description never reaches the store, and an email address is masked before it does.
 */
import { maskEmail } from '@/lib/business';
import type { Store } from '../store.js';
import type { EventEnvelope } from './payload.js';

/** Routing keys bound besides the heartbeats. Never `#`: other systems' traffic is none of ours. */
export const BUSINESS_BINDINGS = ['bank.payment.#', 'events.#', 'billing.#', 'infra.#'];

/** Payload fields that are kept. Anything else is dropped before storing. */
const KEPT_FIELDS = new Set([
  'reference', 'transactionId', 'senderWalletId', 'receiverWalletId', 'walletId', 'userId', 'deploymentId', 'deploymentIds',
  'amount', 'currency', 'balance', 'available', 'hoursLeft', 'reason', 'accountType', 'periodStart', 'periodEnd', 'status',
]);
const EMAIL_FIELDS = new Set(['customerEmail', 'email']);
const REASON_MAX = 200;

/** The payload as it may be stored: known fields only, emails masked, free text cut short. */
export function keptFields(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (EMAIL_FIELDS.has(k) && typeof v === 'string') out[k] = maskEmail(v);
    else if (k === 'reason' && typeof v === 'string') out[k] = v.slice(0, REASON_MAX);
    else if (KEPT_FIELDS.has(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v))) out[k] = v;
  }
  return out;
}

/** The series message throughput is stored under (`bus_messages` / this), one sample per minute. */
export const THROUGHPUT_SERIES = 'finvault.events';
const MINUTE = 60_000;

export class BusinessRecorder {
  private minute = -1;
  private count = 0;

  constructor(private readonly store: Store) {}

  /** Counts every message heard (heartbeats included) towards the per-minute throughput. */
  heard(now: number): void {
    const minute = Math.floor(now / MINUTE) * MINUTE;
    if (minute !== this.minute) {
      if (this.minute >= 0) this.store.addSample('bus_messages', THROUGHPUT_SERIES, this.minute, this.count);
      this.minute = minute;
      this.count = 0;
    }
    this.count += 1;
  }

  /** Stores one non-heartbeat event. Returns false for a redelivery (same event id) or an unusable message. */
  record(routingKey: string, envelope: EventEnvelope, payload: Record<string, unknown>, now: number): boolean {
    const type = envelope.event?.type;
    if (typeof type !== 'string' || type.startsWith('heartbeat.')) return false;
    const stamped = Date.parse(envelope.timestamp);
    return this.store.addEvent({
      id: typeof envelope.eventId === 'string' && envelope.eventId ? envelope.eventId : `${routingKey}:${now}`,
      // The publisher's clock, unless it is missing or in the future.
      ts: Number.isFinite(stamped) && stamped <= now ? stamped : now,
      routingKey,
      type,
      source: typeof envelope.source === 'string' ? envelope.source : 'unknown',
      data: keptFields(payload),
    });
  }
}
