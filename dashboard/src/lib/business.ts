/** Pure helpers for the Business page: credit standing, privacy masking and the dead-letter queue. */
import type { AccountStanding } from '@/api/types';

/**
 * Mask an email address to `t***@e***.com`. The contract already sends payers masked; this runs again
 * on display so a backend slip never puts a full address on screen. Idempotent.
 */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at < 1) return '***';
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  if (dot < 1) return '***';
  return `${value[0]}***@${domain[0]}***${domain.slice(dot)}`;
}

/** out = cannot run (402 on start); low = under LOW_CREDIT_HOURS; idle = nothing running, no estimate. */
export type CreditState = 'out' | 'low' | 'ok' | 'idle';

export function creditState(a: AccountStanding, lowCreditHours: number): CreditState {
  if (!a.canRun) return 'out';
  if (a.hoursLeft === null) return 'idle';
  return a.hoursLeft < lowCreditHours ? 'low' : 'ok';
}

/** Most urgent first: cannot run, then the shortest runway; accounts with nothing running last. */
export function sortByHoursLeft(accounts: AccountStanding[]): AccountStanding[] {
  const rank = (a: AccountStanding) => (!a.canRun ? -1 : a.hoursLeft ?? Number.POSITIVE_INFINITY);
  return [...accounts].sort((a, b) => rank(a) - rank(b) || a.accountId.localeCompare(b.accountId));
}

export function formatHoursLeft(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return '< 1 h';
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

/** The sentence NexusInfra's Control Room uses for its DLQ watch (#243), so both panels say the same. */
export function describeDlq(depth: number | null): string {
  if (depth === null) return 'The dead-letter queue could not be read, so whether anything failed is unknown.';
  if (depth === 0) return 'No failed events.';
  return depth === 1
    ? '1 event could not be processed and is waiting in the dead-letter queue.'
    : `${depth} events could not be processed and are waiting in the dead-letter queue.`;
}
