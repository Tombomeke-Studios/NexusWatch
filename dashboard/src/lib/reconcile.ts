/**
 * Top-up reconciliation, pure. A NexusInfra top-up is a three-step pipeline:
 *
 *   payment.request sent  →  FinVault confirms or fails it  →  credited once in the NexusInfra wallet
 *
 * The rules follow what NexusInfra's Billing Bridge promises (#298, #351): a request the broker did not
 * take fails at once; a confirmation credits once and only for the amount asked; silence turns into
 * *Not confirmed* after TOPUP_TIMEOUT_MS, which is not final — a late confirmation still credits.
 * Anything that breaks those promises is an anomaly with a reason a person can act on.
 */
import type { Severity, TopUpRecord } from '@/api/types';
import { formatDuration, formatEur } from './format';

/** How long the bridge may take to credit after FinVault confirmed, before that is an anomaly. */
export const CREDIT_GRACE_MS = 2 * 60_000;

export type AnomalyKind =
  | 'confirmed-not-credited'
  | 'credited-twice'
  | 'amount-mismatch'
  | 'stuck-not-confirmed'
  | 'late-confirmation'
  | 'credited-without-confirmation';

export const ANOMALY_KINDS: readonly AnomalyKind[] = [
  'confirmed-not-credited', 'credited-twice', 'amount-mismatch', 'stuck-not-confirmed', 'late-confirmation', 'credited-without-confirmation',
];

export const anomalyLabel: Record<AnomalyKind, string> = {
  'confirmed-not-credited': 'Confirmed, not credited',
  'credited-twice': 'Credited twice',
  'amount-mismatch': 'Amount mismatch',
  'stuck-not-confirmed': 'Stuck: not confirmed',
  'late-confirmation': 'Late confirmation',
  'credited-without-confirmation': 'Credit without confirmation',
};

export interface Anomaly {
  kind: AnomalyKind;
  /** critical = money is wrong; warning = money is stuck; info = healed, worth knowing. */
  severity: Severity;
  reason: string;
}

/** Each step of the pipeline: `late` = done, but after the timeout. */
export type StepState = 'done' | 'late' | 'waiting' | 'failed' | 'skipped';

export type Outcome = 'credited' | 'failed' | 'in-flight' | 'not-confirmed' | 'anomaly';

export interface ReconciledTopUp {
  record: TopUpRecord;
  steps: { request: StepState; finvault: StepState; credit: StepState };
  outcome: Outcome;
  anomalies: Anomaly[];
  /** Request → first credit; null when nothing was credited. */
  timeToCreditMs: number | null;
}

export interface ReconcileOptions {
  now: Date;
  /** NexusInfra's TOPUP_TIMEOUT_MS. */
  timeoutMs: number;
  graceMs?: number;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const ms = (iso: string) => new Date(iso).getTime();
/** Money compared in cents, so 0.1 + 0.2 equals 0.3. */
const sameAmount = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

export function reconcile(record: TopUpRecord, { now, timeoutMs, graceMs = CREDIT_GRACE_MS }: ReconcileOptions): ReconciledTopUp {
  const t = now.getTime();
  const requested = ms(record.requestedAt);
  const answer = record.finvault;
  const confirmed = answer?.outcome === 'confirmed';
  const credits = record.credits;
  const creditedTotal = credits.reduce((sum, c) => sum + c.amountEur, 0);
  const anomalies: Anomaly[] = [];
  const add = (kind: AnomalyKind, severity: Severity, reason: string) => anomalies.push({ kind, severity, reason });

  // The moment silence turned into "Not confirmed": the bridge's own mark, or its clock if it never marked it.
  const deadline = record.expiredAt ? ms(record.expiredAt) : requested + timeoutMs;
  const late = confirmed && ms(answer.at) > deadline;

  if (!record.sent) {
    // Not sent is not pending: nothing can answer it, and nothing should be credited.
    if (credits.length) add('credited-without-confirmation', 'critical', `Credited ${formatEur(creditedTotal)} for a request the broker never took.`);
    return finish(record, { request: 'failed', finvault: 'skipped', credit: credits.length ? 'failed' : 'skipped' }, anomalies, null);
  }

  const confirmedAmountWrong = confirmed && !sameAmount(answer.amountEur, record.amountEur);
  if (confirmedAmountWrong) {
    add('amount-mismatch', 'critical', `Requested ${formatEur(record.amountEur)}, FinVault confirmed ${formatEur(answer.amountEur)} — the bridge credits nothing; check it by hand.`);
  }
  const wrongCredit = credits.find((c) => !sameAmount(c.amountEur, record.amountEur));
  if (wrongCredit && !confirmedAmountWrong) {
    add('amount-mismatch', 'critical', `Requested ${formatEur(record.amountEur)}, credited ${formatEur(wrongCredit.amountEur)}.`);
  }

  if (credits.length > 1) {
    const extra = creditedTotal - record.amountEur;
    add('credited-twice', 'critical', `Credited ${credits.length} times for one confirmation — ${formatEur(extra)} too much.`);
  }

  if (credits.length && !confirmed) {
    add('credited-without-confirmation', 'critical', answer
      ? `Credited ${formatEur(creditedTotal)} although FinVault failed it${answer.reason ? ` (${answer.reason})` : ''}.`
      : `Credited ${formatEur(creditedTotal)} with no confirmation from FinVault.`);
  }

  const overdueCredit = confirmed && !credits.length && !confirmedAmountWrong && t - ms(answer.at) > graceMs;
  if (overdueCredit) {
    add('confirmed-not-credited', 'critical', `FinVault confirmed ${formatEur(answer.amountEur)} ${formatDuration((t - ms(answer.at)) / 1000)} ago, but there is no credit in the wallet.`);
  }

  if (!answer && !credits.length && t - requested > timeoutMs) {
    const waited = formatDuration((t - requested) / 1000);
    add('stuck-not-confirmed', 'warning', record.status === 'pending'
      ? `No answer from FinVault after ${waited}, and the bridge still says pending — is its expiry running?`
      : `No answer from FinVault after ${waited}. Check the message key and the dead-letter queue.`);
  }

  if (late) {
    const after = formatDuration((ms(answer.at) - deadline) / 1000);
    add('late-confirmation', 'info', record.expiredAt
      ? `Confirmed ${after} after the top-up turned Not confirmed${credits.length ? '; credited, as it should be.' : '.'}`
      : `Confirmed ${after} after the timeout${credits.length ? '; credited, as it should be.' : '.'}`);
  }

  const finvault: StepState = !answer
    ? (t - requested > timeoutMs ? 'failed' : 'waiting')
    : answer.outcome === 'failed' ? 'failed' : late ? 'late' : 'done';

  let credit: StepState;
  if (credits.length) credit = anomalies.some((a) => a.severity === 'critical') ? 'failed' : 'done';
  else if (confirmed) credit = overdueCredit || confirmedAmountWrong ? 'failed' : 'waiting';
  else credit = answer?.outcome === 'failed' || finvault === 'failed' ? 'skipped' : 'waiting';

  const timeToCreditMs = credits.length ? ms(credits[0].at) - requested : null;
  return finish(record, { request: 'done', finvault, credit }, anomalies, timeToCreditMs);
}

function finish(record: TopUpRecord, steps: ReconciledTopUp['steps'], anomalies: Anomaly[], timeToCreditMs: number | null): ReconciledTopUp {
  anomalies.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const open = anomalies.some((a) => a.severity !== 'info');
  const outcome: Outcome = anomalies.some((a) => a.severity === 'critical')
    ? 'anomaly'
    : open ? 'not-confirmed'
    : steps.credit === 'done' ? 'credited'
    : steps.request === 'failed' || steps.finvault === 'failed' ? 'failed'
    : 'in-flight';
  return { record, steps, outcome, anomalies, timeToCreditMs };
}

export function reconcileAll(records: TopUpRecord[], options: ReconcileOptions): ReconciledTopUp[] {
  return records.map((r) => reconcile(r, options));
}

export interface ReconcileSummary {
  total: number;
  inFlight: number;
  /** Everything that has an outcome: credited, failed, not confirmed or wrong. */
  settled: number;
  credited: number;
  /** credited / settled in percent; null when nothing has settled (unknown is not zero). */
  successRate: number | null;
  medianTimeToCreditMs: number | null;
  /** Critical + warning anomalies — the ones someone has to look at. */
  openAnomalies: number;
  /** Info anomalies: healed on their own, shown for the record. */
  notedAnomalies: number;
  byKind: Record<AnomalyKind, number>;
}

export function summarize(rows: ReconciledTopUp[]): ReconcileSummary {
  const byKind = Object.fromEntries(ANOMALY_KINDS.map((k) => [k, 0])) as Record<AnomalyKind, number>;
  let openAnomalies = 0;
  let notedAnomalies = 0;
  for (const row of rows) {
    for (const a of row.anomalies) {
      byKind[a.kind] += 1;
      if (a.severity === 'info') notedAnomalies += 1;
      else openAnomalies += 1;
    }
  }
  const inFlight = rows.filter((r) => r.outcome === 'in-flight').length;
  const settled = rows.length - inFlight;
  const credited = rows.filter((r) => r.outcome === 'credited').length;
  const times = rows.filter((r) => r.outcome === 'credited' && r.timeToCreditMs !== null).map((r) => r.timeToCreditMs as number);
  return {
    total: rows.length,
    inFlight,
    settled,
    credited,
    successRate: settled ? (credited / settled) * 100 : null,
    medianTimeToCreditMs: median(times),
    openAnomalies,
    notedAnomalies,
    byKind,
  };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
