/**
 * SLO and error-budget maths (Google SRE style). Pure: no React, no dates, every function tested.
 *
 * Inputs are check tallies: `good` (answered in time — `up` and `slow` both count, this is an
 * availability SLO), `bad` (failed) and `unknown` (no data: agent offline, collector gap).
 * Unknown checks are excluded from every calculation — never counted as up, never as down.
 */
import type { BurnWindow, CheckTally, HealthStatus, Severity } from '@/api/types';

const MINUTES_PER_DAY = 24 * 60;

/** Fraction of checks allowed to fail, e.g. 99.9 → 0.001. Throws on a target with no budget. */
function allowedErrorRate(targetPct: number): number {
  if (!(targetPct > 0 && targetPct < 100)) throw new RangeError(`SLO target must be between 0 and 100 (exclusive), got ${targetPct}`);
  return 1 - targetPct / 100;
}

const answered = (t: CheckTally) => t.good + t.bad;

/** Tally a status strip; `null` is a check that got no data. */
export function tallyStatuses(statuses: readonly (HealthStatus | null)[]): CheckTally {
  const t: CheckTally = { good: 0, bad: 0, unknown: 0 };
  for (const s of statuses) {
    if (s === null) t.unknown++;
    else if (s === 'down') t.bad++;
    else t.good++;
  }
  return t;
}

export function sumTallies(tallies: readonly CheckTally[]): CheckTally {
  return tallies.reduce((acc, t) => ({ good: acc.good + t.good, bad: acc.bad + t.bad, unknown: acc.unknown + t.unknown }), { good: 0, bad: 0, unknown: 0 });
}

/** Share of good checks in percent, or null when no check was answered. */
export function attainment(t: CheckTally): number | null {
  const n = answered(t);
  return n === 0 ? null : (t.good / n) * 100;
}

/** Total error budget of a window in minutes: 99.9% over 30 days → 43.2 min. */
export function errorBudgetMinutes(targetPct: number, windowDays: number): number {
  return allowedErrorRate(targetPct) * windowDays * MINUTES_PER_DAY;
}

/**
 * Burn rate: how fast the budget is spent compared to "exactly on budget".
 * 1 = the budget lasts precisely the window; 14.4 = a 30-day budget gone in ~2 days. Null without data.
 */
export function burnRate(targetPct: number, t: CheckTally): number | null {
  const n = answered(t);
  return n === 0 ? null : t.bad / n / allowedErrorRate(targetPct);
}

/**
 * Fraction of the window's budget still left (1 = untouched, 0 = spent, negative = overspent).
 * The observed error rate is taken as representative for the whole window.
 */
export function budgetRemaining(targetPct: number, t: CheckTally): number | null {
  const burn = burnRate(targetPct, t);
  return burn === null ? null : 1 - burn;
}

/** Budget left in minutes; negative when overspent. */
export function remainingBudgetMinutes(targetPct: number, windowDays: number, t: CheckTally): number | null {
  const left = budgetRemaining(targetPct, t);
  return left === null ? null : left * errorBudgetMinutes(targetPct, windowDays);
}

/**
 * Minutes until the budget runs out if the current burn rate holds.
 * At burn rate b the service fails b × (1 − target) of the time, so each minute spends that much budget.
 * `Infinity` when nothing burns, 0 when already exhausted, null when either input is unknown.
 */
export function timeToExhaustionMinutes(remainingMinutes: number | null, burn: number | null, targetPct: number): number | null {
  if (remainingMinutes === null || burn === null) return null;
  if (remainingMinutes <= 0) return 0;
  if (burn === 0) return Infinity;
  return remainingMinutes / (burn * allowedErrorRate(targetPct));
}

/** The burn rate at which `budgetFraction` of a `sloDays` budget is spent within `alertHours`. */
export function burnThreshold(budgetFraction: number, sloDays: number, alertHours: number): number {
  return (budgetFraction * sloDays * 24) / alertHours;
}

const WINDOW_HOURS: Record<BurnWindow, number> = { '5m': 5 / 60, '30m': 0.5, '1h': 1, '2h': 2, '6h': 6, '24h': 24 };

export interface BurnRule {
  id: 'fast' | 'medium' | 'slow';
  label: string;
  severity: Severity;
  long: BurnWindow;
  short: BurnWindow;
  /** Share of the whole budget that the long window may spend before this fires. */
  budgetFraction: number;
}

/**
 * Multi-window, multi-burn-rate alerts from the Google SRE workbook. The long window says the burn
 * is significant; the short window (1/12 of it) confirms it is still happening, so an alert resets
 * soon after recovery instead of firing for the rest of the long window.
 */
export const BURN_RULES: readonly BurnRule[] = [
  { id: 'fast', label: 'Fast burn', severity: 'critical', long: '1h', short: '5m', budgetFraction: 0.02 },
  { id: 'medium', label: 'Sustained burn', severity: 'critical', long: '6h', short: '30m', budgetFraction: 0.05 },
  { id: 'slow', label: 'Slow burn', severity: 'warning', long: '24h', short: '2h', budgetFraction: 0.1 },
];

export interface BurnAlert extends BurnRule {
  threshold: number;
  longBurn: number;
  shortBurn: number;
}

/** Which burn rules fire. A window with unknown burn (null) never fires a rule. */
export function evaluateBurnAlerts(burn: Record<BurnWindow, number | null>, sloDays: number): BurnAlert[] {
  return BURN_RULES.flatMap((rule) => {
    const threshold = burnThreshold(rule.budgetFraction, sloDays, WINDOW_HOURS[rule.long]);
    const longBurn = burn[rule.long];
    const shortBurn = burn[rule.short];
    if (longBurn === null || shortBurn === null) return [];
    return longBurn >= threshold && shortBurn >= threshold ? [{ ...rule, threshold, longBurn, shortBurn }] : [];
  });
}

/**
 * Budget remaining (fraction) at the end of each period, oldest first. The window's budget is
 * sized from all answered checks in it, so the last point equals `budgetRemaining` for the window.
 * A period with only unknown checks spends nothing. Empty when the window has no answered checks.
 */
export function burnDown(targetPct: number, periods: readonly CheckTally[]): number[] {
  const total = answered(sumTallies(periods));
  if (total === 0) return [];
  const budgetChecks = allowedErrorRate(targetPct) * total;
  let spent = 0;
  return periods.map((p) => {
    spent += p.bad;
    return 1 - spent / budgetChecks;
  });
}

export type SloState = 'healthy' | 'at-risk' | 'breached' | 'unknown';

/** Below a quarter of the budget, or with any burn alert firing, an SLO is at risk. */
export function sloState(remaining: number | null, alerts: readonly BurnAlert[]): SloState {
  if (remaining === null) return 'unknown';
  if (remaining < 0) return 'breached';
  if (remaining < 0.25 || alerts.length > 0) return 'at-risk';
  return 'healthy';
}
