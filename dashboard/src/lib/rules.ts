/**
 * Pure alerting logic: rule conditions (parse, format, validate, evaluate), silences,
 * maintenance windows, escalation progress and history filters. No React, no I/O.
 */
import type {
  AlertHistoryItem, AlertRule, AlertRuleInput, ChannelId, Comparator, EscalationPolicy, EscalationStep,
  MaintenanceWindow, ProjectId, RuleCondition, RuleMetric, Severity, SilenceDuration, TargetState,
} from '@/api/types';

// ── Metrics ────────────────────────────────────────────────────────────
export interface MetricDef {
  id: RuleMetric;
  label: string;
  /** The key used in the written condition (`queue_ready > 25`). */
  key: string;
  /** Unit shown next to the threshold field; only `%` is written into the condition. */
  unit: '%' | 'ms' | 'messages' | 'per hour' | '0 or 1';
  source: string;
  projects: ProjectId[];
  min: number;
  max?: number;
  integer?: boolean;
}

const BOTH: ProjectId[] = ['nexusinfra', 'finvault'];

export const METRICS: Record<RuleMetric, MetricDef> = {
  heartbeat: { id: 'heartbeat', label: 'Heartbeat', key: 'heartbeat', unit: '0 or 1', source: 'Health check per service: 1 answering, 0 not', projects: BOTH, min: 0, max: 1, integer: true },
  latency: { id: 'latency', label: 'Latency', key: 'latency_ms', unit: 'ms', source: 'Health-check response time per service', projects: BOTH, min: 0 },
  cpu: { id: 'cpu', label: 'CPU', key: 'cpu', unit: '%', source: 'Node agent, per node', projects: ['nexusinfra'], min: 0, max: 100 },
  memory: { id: 'memory', label: 'Memory', key: 'memory', unit: '%', source: 'Node agent, per node', projects: ['nexusinfra'], min: 0, max: 100 },
  disk: { id: 'disk', label: 'Disk', key: 'disk', unit: '%', source: 'Node agent, per node', projects: ['nexusinfra'], min: 0, max: 100 },
  queue_depth: { id: 'queue_depth', label: 'Queue depth', key: 'queue_ready', unit: 'messages', source: 'Ready messages per RabbitMQ queue', projects: ['finvault'], min: 0, integer: true },
  error_rate: { id: 'error_rate', label: '5xx rate', key: 'error_rate', unit: '%', source: 'Share of 5xx responses per service', projects: ['finvault'], min: 0, max: 100 },
  topups: { id: 'topups', label: 'Top-ups', key: 'topups', unit: 'per hour', source: 'FinVault top-ups per hour', projects: ['finvault'], min: 0, integer: true },
};

export const METRIC_IDS = Object.keys(METRICS) as RuleMetric[];
export const COMPARATORS: readonly Comparator[] = ['>', '>=', '<', '<=', '==', '!='];

export function metricsFor(project: ProjectId): MetricDef[] {
  return METRIC_IDS.map((id) => METRICS[id]).filter((m) => m.projects.includes(project));
}

// ── Durations ──────────────────────────────────────────────────────────
const UNIT_SECONDS = { d: 86_400, h: 3_600, m: 60, s: 1 } as const;
export const MAX_FOR_SECONDS = 7 * 86_400;

/** `5m` → 300, `1h30m` → 5400, `` → 0. Returns null when the text is not a duration. */
export function parseDuration(text: string): number | null {
  const t = text.replace(/\s+/g, '').toLowerCase();
  if (t === '') return 0;
  if (!/^(\d+[dhms])+$/.test(t)) return null;
  let total = 0;
  for (const [, n, unit] of t.matchAll(/(\d+)([dhms])/g)) total += Number(n) * UNIT_SECONDS[unit as keyof typeof UNIT_SECONDS];
  return total;
}

/** 300 → `5m`, 5400 → `1h30m`, 0 → `0s`. The inverse of `parseDuration`. */
export function formatSpan(seconds: number): string {
  if (seconds <= 0) return '0s';
  let rest = Math.round(seconds);
  let out = '';
  for (const [unit, size] of Object.entries(UNIT_SECONDS)) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      out += `${n}${unit}`;
      rest -= n * size;
    }
  }
  return out;
}

/** Countdown for an expiry: `14:59` under an hour, `3h 59m` above. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
}

// ── Conditions ─────────────────────────────────────────────────────────
function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

/** `{ queue_depth, >, 25, 300 }` → `queue_ready > 25 for 5m`. */
export function formatCondition(c: RuleCondition): string {
  const m = METRICS[c.metric];
  const threshold = `${formatNumber(c.threshold)}${m.unit === '%' ? '%' : ''}`;
  return `${m.key} ${c.comparator} ${threshold}${c.forSeconds > 0 ? ` for ${formatSpan(c.forSeconds)}` : ''}`;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const CONDITION_RE = /^\s*([a-z_]+)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\s*(%?)\s*(?:for\s+(.+?))?\s*$/i;

/** Parses a written condition back into its parts — the inverse of `formatCondition`. */
export function parseCondition(text: string): Parsed<RuleCondition> {
  const match = CONDITION_RE.exec(text);
  if (!match) return { ok: false, error: 'Write it as: metric comparator threshold [for duration]' };
  const [, key, comparator, num, pct, forText] = match;
  const metric = METRIC_IDS.find((id) => METRICS[id].key === key.toLowerCase());
  if (!metric) return { ok: false, error: `Unknown metric "${key}"` };
  if (pct && METRICS[metric].unit !== '%') return { ok: false, error: `${METRICS[metric].key} is not a percentage` };
  const forSeconds = parseDuration(forText ?? '');
  if (forSeconds === null) return { ok: false, error: `"${forText}" is not a duration (try 5m or 1h30m)` };
  return { ok: true, value: { metric, comparator: comparator as Comparator, threshold: Number(num), forSeconds } };
}

export function compare(value: number, comparator: Comparator, threshold: number): boolean {
  switch (comparator) {
    case '>': return value > threshold;
    case '>=': return value >= threshold;
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    case '!=': return value !== threshold;
  }
}

// ── Evaluation ─────────────────────────────────────────────────────────
/** Recent samples for one target (a service, node or queue), oldest first; null = no answer. */
export interface Reading {
  target: string;
  project: ProjectId;
  serviceId?: string;
  samples: (number | null)[];
  stepSeconds: number;
}

export interface TargetResult {
  target: string;
  serviceId?: string;
  state: TargetState;
  value: number | null;
  /** How long the condition has held, counting back from the newest sample. */
  heldSeconds: number;
}

/**
 * Evaluates one target. The newest samples are walked backwards while they breach;
 * an unknown sample stops the walk — unknown is never treated as a value.
 */
export function evaluateReading(c: RuleCondition, r: Reading): TargetResult {
  const base = { target: r.target, ...(r.serviceId ? { serviceId: r.serviceId } : {}) };
  const last = r.samples.at(-1);
  if (last === undefined || last === null) return { ...base, state: 'no_data', value: null, heldSeconds: 0 };
  let k = 0;
  for (let i = r.samples.length - 1; i >= 0; i--) {
    const v = r.samples[i];
    if (v === null || !compare(v, c.comparator, c.threshold)) break;
    k++;
  }
  const heldSeconds = k * r.stepSeconds;
  const state: TargetState = k === 0 ? 'ok' : heldSeconds >= c.forSeconds ? 'firing' : 'pending';
  return { ...base, state, value: last, heldSeconds };
}

/** Evaluates a rule against every reading of its project. Fires when any target fires. */
export function evaluateRule(rule: Pick<AlertRuleInput, 'condition' | 'project'>, readings: Reading[]): { fires: boolean; targets: TargetResult[] } {
  const targets = readings.filter((r) => r.project === rule.project).map((r) => evaluateReading(rule.condition, r));
  return { fires: targets.some((t) => t.state === 'firing'), targets };
}

// ── Rule drafts (the editor's form state) ──────────────────────────────
export interface RuleDraft {
  name: string;
  project: ProjectId;
  metric: RuleMetric;
  comparator: Comparator;
  threshold: string;
  forText: string;
  severity: Severity;
  channels: ChannelId[];
  escalationPolicyId: string | null;
  runbookUrl: string;
  enabled: boolean;
}

export type RuleField = 'name' | 'metric' | 'threshold' | 'for' | 'channels' | 'runbookUrl';
export type RuleErrors = Partial<Record<RuleField, string>>;

export const NAME_MAX = 60;

export function emptyDraft(project: ProjectId = 'nexusinfra'): RuleDraft {
  return { name: '', project, metric: 'heartbeat', comparator: '==', threshold: '0', forText: '90s', severity: 'warning', channels: ['discord'], escalationPolicyId: null, runbookUrl: '', enabled: true };
}

/** Editor state for an existing rule; `copy` makes it a new rule named "… (copy)". */
export function draftFromRule(rule: AlertRule, copy = false): RuleDraft {
  return {
    name: copy ? `${rule.name} (copy)`.slice(0, NAME_MAX) : rule.name,
    project: rule.project,
    metric: rule.condition.metric,
    comparator: rule.condition.comparator,
    threshold: formatNumber(rule.condition.threshold),
    forText: rule.condition.forSeconds > 0 ? formatSpan(rule.condition.forSeconds) : '',
    severity: rule.severity,
    channels: [...rule.channels],
    escalationPolicyId: rule.escalationPolicyId,
    runbookUrl: rule.runbookUrl,
    enabled: rule.enabled,
  };
}

function thresholdError(d: RuleDraft): string | undefined {
  const m = METRICS[d.metric];
  const text = d.threshold.trim();
  if (text === '') return 'Enter a threshold';
  if (!/^-?\d+(\.\d+)?$/.test(text)) return 'The threshold must be a number';
  const n = Number(text);
  if (m.integer && !Number.isInteger(n)) return `${m.label} is a whole number`;
  if (n < m.min) return `${m.label} cannot be below ${m.min}`;
  if (m.max !== undefined && n > m.max) return `${m.label} cannot be above ${m.max}`;
  return undefined;
}

export function isHttpUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The condition a draft describes, or null while its condition fields are invalid (for the preview). */
export function draftCondition(d: RuleDraft): RuleCondition | null {
  const forSeconds = parseDuration(d.forText);
  if (thresholdError(d) || forSeconds === null || forSeconds > MAX_FOR_SECONDS) return null;
  return { metric: d.metric, comparator: d.comparator, threshold: Number(d.threshold.trim()), forSeconds };
}

/** Validates the whole draft; `rule` is the API body when there are no errors. */
export function validateDraft(d: RuleDraft): { errors: RuleErrors; rule: AlertRuleInput | null } {
  const errors: RuleErrors = {};
  const name = d.name.trim();
  if (!name) errors.name = 'Give the rule a name';
  else if (name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters`;

  const m = METRICS[d.metric];
  if (!m.projects.includes(d.project)) errors.metric = `${m.label} is only measured for ${m.projects.map((p) => (p === 'finvault' ? 'FinVault' : 'NexusInfra')).join(' and ')}`;

  const tErr = thresholdError(d);
  if (tErr) errors.threshold = tErr;

  const forSeconds = parseDuration(d.forText);
  if (forSeconds === null) errors.for = 'Use a duration such as 90s, 5m or 1h30m';
  else if (forSeconds > MAX_FOR_SECONDS) errors.for = 'At most 7 days';

  if (d.channels.length === 0) errors.channels = 'Pick at least one channel';

  const url = d.runbookUrl.trim();
  if (url && !isHttpUrl(url)) errors.runbookUrl = 'Enter a full http(s) link, or leave it empty';

  const condition = draftCondition(d);
  if (Object.keys(errors).length > 0 || !condition) return { errors, rule: null };
  return {
    errors,
    rule: { name, project: d.project, condition, severity: d.severity, channels: [...d.channels], escalationPolicyId: d.escalationPolicyId, runbookUrl: url, enabled: d.enabled },
  };
}

// ── Silences ───────────────────────────────────────────────────────────
export const SILENCE_OPTIONS: readonly { id: SilenceDuration; label: string; seconds: number | null }[] = [
  { id: '15m', label: '15 min', seconds: 15 * 60 },
  { id: '1h', label: '1 hour', seconds: 3600 },
  { id: '4h', label: '4 hours', seconds: 4 * 3600 },
  { id: 'resolved', label: 'Until resolved', seconds: null },
];

/** When a silence of this duration, created at `now`, ends; null = until resolved. */
export function silenceEndsAt(duration: SilenceDuration, now: number): string | null {
  const seconds = SILENCE_OPTIONS.find((o) => o.id === duration)?.seconds ?? null;
  return seconds === null ? null : new Date(now + seconds * 1000).toISOString();
}

/** Seconds left on a silence; null = until resolved. Never negative. */
export function remainingSeconds(endsAt: string | null, now: number): number | null {
  if (endsAt === null) return null;
  return Math.max(0, Math.round((Date.parse(endsAt) - now) / 1000));
}

export const REASON_MAX = 200;

export function validateReason(reason: string): string | undefined {
  const r = reason.trim();
  if (!r) return 'Say why, so whoever looks next knows';
  if (r.length > REASON_MAX) return `Keep it under ${REASON_MAX} characters`;
  return undefined;
}

// ── Maintenance windows ────────────────────────────────────────────────
const WEEK_MS = 7 * 86_400_000;

/** The occurrence of a window that is running now or comes next; null when a one-off has ended. */
export function windowOccurrence(w: Pick<MaintenanceWindow, 'startsAt' | 'durationMinutes' | 'recurrence'>, now: number): { start: number; end: number } | null {
  const first = Date.parse(w.startsAt);
  const length = w.durationMinutes * 60_000;
  if (w.recurrence === 'none' || now < first) return now < first + length ? { start: first, end: first + length } : null;
  const k = Math.floor((now - first) / WEEK_MS);
  const start = first + k * WEEK_MS;
  return now < start + length ? { start, end: start + length } : { start: start + WEEK_MS, end: start + WEEK_MS + length };
}

export function isWindowActive(w: Pick<MaintenanceWindow, 'startsAt' | 'durationMinutes' | 'recurrence'>, now: number): boolean {
  const occ = windowOccurrence(w, now);
  return occ !== null && occ.start <= now && now < occ.end;
}

/** Whether a window covers an alert on this project/service right now. */
export function windowCovers(w: MaintenanceWindow, target: { project: ProjectId; serviceId: string }, now: number): boolean {
  return w.project === target.project && (w.serviceId === null || w.serviceId === target.serviceId) && isWindowActive(w, now);
}

export function validateWindow(w: { title: string; startsAt: string; durationMinutes: number }): Partial<Record<'title' | 'startsAt' | 'duration', string>> {
  const errors: Partial<Record<'title' | 'startsAt' | 'duration', string>> = {};
  if (!w.title.trim()) errors.title = 'Give the window a title';
  if (!w.startsAt || Number.isNaN(Date.parse(w.startsAt))) errors.startsAt = 'Pick a start date and time';
  if (!Number.isInteger(w.durationMinutes) || w.durationMinutes < 5) errors.duration = 'At least 5 minutes';
  else if (w.durationMinutes > 7 * 24 * 60) errors.duration = 'At most 7 days';
  return errors;
}

// ── Escalation ─────────────────────────────────────────────────────────
export type StepState = 'sent' | 'upcoming' | 'skipped' | 'paused' | 'suppressed';

export interface StepProgress {
  step: EscalationStep;
  state: StepState;
  /** Seconds until an upcoming step runs. */
  inSeconds?: number;
}

/**
 * Where an alert is in its escalation policy. A step runs `afterMinutes` after the alert fired;
 * acknowledging skips the steps not yet run, a silence pauses them and maintenance suppresses all.
 */
export function escalationProgress(
  policy: EscalationPolicy,
  a: { elapsedSeconds: number; acknowledgedAfterSeconds: number | null; silenced: boolean; inMaintenance: boolean },
): StepProgress[] {
  return policy.steps.map((step) => {
    const at = step.afterMinutes * 60;
    if (a.inMaintenance) return { step, state: 'suppressed' };
    const ackAt = a.acknowledgedAfterSeconds;
    if (at <= a.elapsedSeconds && (ackAt === null || at <= ackAt)) return { step, state: 'sent' };
    if (ackAt !== null) return { step, state: 'skipped' };
    if (a.silenced) return { step, state: 'paused' };
    return { step, state: 'upcoming', inSeconds: at - a.elapsedSeconds };
  });
}

/** `Discord now → Telegram after 5m → Push after 15m`. */
export function formatPolicy(steps: EscalationStep[], channelName: (id: ChannelId) => string): string {
  return steps.map((s) => `${channelName(s.channel)} ${s.afterMinutes === 0 ? 'now' : `after ${formatSpan(s.afterMinutes * 60)}`}`).join(' → ');
}

export const STEP_MAX_MINUTES = 24 * 60;

export function validatePolicy(p: { name: string; steps: EscalationStep[] }): Partial<Record<'name' | 'steps', string>> {
  const errors: Partial<Record<'name' | 'steps', string>> = {};
  if (!p.name.trim()) errors.name = 'Give the policy a name';
  if (p.steps.length === 0) errors.steps = 'Add at least one step';
  else if (p.steps.some((s) => !Number.isInteger(s.afterMinutes) || s.afterMinutes < 0 || s.afterMinutes > STEP_MAX_MINUTES)) errors.steps = 'Each step runs 0 to 1440 minutes after the alert';
  else if (p.steps.some((s, i) => i > 0 && s.afterMinutes <= p.steps[i - 1].afterMinutes)) errors.steps = 'Each step must come later than the one before';
  return errors;
}

// ── History ────────────────────────────────────────────────────────────
export interface HistoryFilter {
  project: ProjectId | 'all';
  severity: Severity | 'all';
  state: 'all' | 'open' | 'resolved';
}

export const ALL_HISTORY: HistoryFilter = { project: 'all', severity: 'all', state: 'all' };

export function filterHistory(items: AlertHistoryItem[], f: HistoryFilter): AlertHistoryItem[] {
  return items.filter(
    (h) =>
      (f.project === 'all' || h.project === f.project) &&
      (f.severity === 'all' || h.severity === f.severity) &&
      (f.state === 'all' || (f.state === 'open') === h.open),
  );
}
