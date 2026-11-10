/**
 * Server-side rule evaluation. Every enabled rule is evaluated against the live readings with the
 * same function the dashboard uses (`evaluateRule` in lib/rules.ts): a target fires once its
 * condition has held for the rule's duration, and an unknown sample never counts as a value.
 *
 * A firing target opens an incident with the subject `rule:<ruleId>:<target>`, which makes it an
 * active alert, puts it in the history and lets the notifier deliver it. It closes when the
 * condition stops holding, when the rule is deleted or switched off, or when the target is no
 * longer measured at all. "No data" on a target that is still known closes nothing: a silent
 * source is not a recovery.
 *
 * Heartbeat rules are not evaluated here. The health checker and the heartbeat tracker open the
 * "not responding" / "offline" incidents themselves (after NW_HEALTH_FAILURES_FOR_INCIDENT failed
 * checks), and evaluating `heartbeat == 0` as well would raise every outage twice.
 */
import { METRICS, evaluateRule, formatCondition, type TargetResult } from '../../../dashboard/src/lib/rules.js';
import type { AlertRule, AlertRuleInput, RuleTestResult } from '../contract.js';
import type { Task } from '../sources/types.js';
import { rules as storedRules } from '../views/alerts.js';
import type { Ctx } from '../views/ctx.js';
import { iso } from '../views/ctx.js';
import { liveReadings, type MetricReading } from './readings.js';

export const RULE_PREFIX = 'rule:';
/** The target part of a subject: the service id when the target is a service, else its name. */
const keyOf = (t: TargetResult) => t.serviceId ?? t.target;
export const subjectOf = (ruleId: string, key: string) => `${RULE_PREFIX}${ruleId}:${key}`;

/** `rule:r5:node-pi` → `{ ruleId: 'r5', key: 'node-pi' }`; null for any other subject. */
export function parseSubject(subject: string): { ruleId: string; key: string } | null {
  if (!subject.startsWith(RULE_PREFIX)) return null;
  const rest = subject.slice(RULE_PREFIX.length);
  const i = rest.indexOf(':');
  return i <= 0 ? null : { ruleId: rest.slice(0, i), key: rest.slice(i + 1) };
}

/** `140 ms`, `93%`, or `no data`. */
export function formatValue(metric: AlertRule['condition']['metric'], value: number | null): string {
  if (value === null) return 'no data';
  const unit = METRICS[metric].unit;
  const n = Math.round(value * 10) / 10;
  return unit === '%' ? `${n}%` : unit === 'ms' ? `${n} ms` : String(n);
}

const forMetric = (readings: MetricReading[], metric: string) => readings.filter((r) => r.metric === metric).map((r) => r.reading);

/** One evaluation pass. Exported for tests; `rulesTask` runs it on an interval. */
export function evaluateRules(ctx: Ctx): void {
  if (!ctx.live.logs) return;
  const now = ctx.clock();
  const rules = storedRules(ctx).filter((r) => r.enabled && r.condition.metric !== 'heartbeat');
  const horizon = Math.max(0, ...rules.map((r) => r.condition.forSeconds));
  const readings = liveReadings(ctx, horizon);
  const log = (rule: AlertRule, level: 'error' | 'warn' | 'ok', message: string, key: string) =>
    ctx.store.addLog({ ts: now, level, service: 'collector', project: rule.project, node: ctx.config.host.name, message, fields: { rule: rule.id, target: key } });

  /** Every (rule, target) that is still measured: its incident, if any, stays as it is. */
  const measured = new Set<string>();
  for (const rule of rules) {
    for (const t of evaluateRule(rule, forMetric(readings, rule.condition.metric)).targets) {
      const subject = subjectOf(rule.id, keyOf(t));
      measured.add(subject);
      const open = ctx.store.openIncidentFor(subject);
      if (t.state === 'firing' && !open) {
        const title = `${rule.name}: ${t.target}`;
        ctx.store.openIncident({
          subject,
          project: rule.project,
          severity: rule.severity,
          title,
          note: `${formatCondition(rule.condition)} — ${formatValue(rule.condition.metric, t.value)} when it fired.`,
          startedAt: now,
        });
        log(rule, rule.severity === 'critical' ? 'error' : 'warn', `Alert fired — ${title} (${formatValue(rule.condition.metric, t.value)})`, keyOf(t));
      } else if (t.state === 'ok' && open) {
        ctx.store.closeIncidents(subject, now);
        log(rule, 'ok', `Alert resolved — ${rule.name}: ${t.target} (${formatValue(rule.condition.metric, t.value)})`, keyOf(t));
      }
    }
  }

  // The rule is gone or off, or the target is no longer measured: nothing can resolve these any more.
  for (const i of ctx.store.incidents(now)) {
    if (i.endedAt === null && i.subject.startsWith(RULE_PREFIX) && !measured.has(i.subject)) ctx.store.closeIncidents(i.subject, now);
  }
}

export function rulesTask(ctx: Ctx): Task {
  return { name: 'rules', intervalMs: ctx.config.rulesIntervalMs, run: async () => evaluateRules(ctx) };
}

/** `POST /alert-rules/test` against live data: the same evaluation, for a rule that may not be saved. */
export function testRuleLive(ctx: Ctx, input: Pick<AlertRuleInput, 'project' | 'condition'>): RuleTestResult {
  const readings = liveReadings(ctx, input.condition.forSeconds);
  const { fires, targets } = evaluateRule(input, forMetric(readings, input.condition.metric));
  return { evaluatedAt: iso(ctx.clock()), fires, targets };
}

/** What an active rule alert shows: its current value and the recent samples. */
export function currentReading(ctx: Ctx, rule: AlertRule, key: string): { value: string; trend: number[] } {
  const reading = forMetric(liveReadings(ctx, 40 * 60), rule.condition.metric).find((r) => (r.serviceId ?? r.target) === key);
  const samples = reading?.samples ?? [];
  return { value: formatValue(rule.condition.metric, samples.at(-1) ?? null), trend: samples.filter((v): v is number => v !== null).slice(-40) };
}
