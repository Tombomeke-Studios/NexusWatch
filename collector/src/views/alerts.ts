/**
 * Incidents and alerts. With a live source, every open incident is an active alert: the health
 * checker and the heartbeat tracker open the "not responding" / "offline" ones, rule evaluation
 * (alerting/evaluate.ts) opens the rest. Rules, silences, maintenance windows and policies are the
 * stored set the dashboard edits; acknowledgements and rule toggles are stored either way.
 */
import { formatCondition, windowCovers } from '../../../dashboard/src/lib/rules.js';
import { currentReading, parseSubject } from '../alerting/evaluate.js';
import type { ActiveAlert, AlertNote, AlertRule, AlertsData, Incident, MaintenanceWindow, Silence } from '../contract.js';
import { HttpError } from '../routes.js';
import type { IncidentRow } from '../store.js';
import { DAY_MS, iso, seconds, type Ctx } from './ctx.js';
import { saveState } from './persist.js';

const ACKS = 'alerts.acknowledged';
const RULES = 'alerts.rules';

function toIncident(i: IncidentRow, now: number): Incident {
  return { id: i.id, open: i.endedAt === null, severity: i.severity, title: i.title, note: i.note, startedAt: iso(i.startedAt), durationSeconds: seconds((i.endedAt ?? now) - i.startedAt) };
}

export function incidents(ctx: Ctx): Incident[] {
  if (!ctx.live.logs) return ctx.sample.heartbeats().incidents;
  const now = ctx.clock();
  return ctx.store.incidents(now - 90 * DAY_MS).map((i) => toIncident(i, now));
}

interface Ack {
  /** Null for acknowledgements stored before the time was kept. */
  at: string | null;
  note: string;
}

/** Acknowledgements by alert id. Older stores hold a plain list of ids. */
function acks(ctx: Ctx): Map<string, Ack> {
  const stored = ctx.store.get<string[] | Record<string, Ack>>(ACKS) ?? {};
  return Array.isArray(stored) ? new Map(stored.map((id) => [id, { at: null, note: '' }])) : new Map(Object.entries(stored));
}

/** When a live alert was acknowledged (ms), or null: not acknowledged, or the time was not kept. */
export function acknowledgedAt(ctx: Ctx, id: string): number | null {
  const at = acks(ctx).get(id)?.at;
  return at ? Date.parse(at) : null;
}

const ackNotes = (id: string, ack: Ack | undefined): AlertNote[] => (ack?.at ? [{ id: `${id}-ack`, kind: 'acknowledged', text: ack.note, at: ack.at }] : []);

/**
 * Sample alerts are acknowledged in the sample module (which keeps the time and the note; 404 when
 * the alert is not active) and snapshotted. A live alert must be an open incident (404 otherwise);
 * its first acknowledgement is kept with its time and note, which also stops the escalation.
 */
export function acknowledge(ctx: Ctx, id: string, note = ''): void {
  if (!ctx.live.logs) {
    ctx.sample.acknowledgeAlert(id, note);
    saveState(ctx.store);
  } else if (!ctx.store.incidents(ctx.clock()).some((i) => i.id === id && i.endedAt === null)) {
    throw new HttpError(404, `Alert ${id} is not active`);
  }
  const all = acks(ctx);
  if (!all.has(id)) all.set(id, { at: iso(ctx.clock()), note: note.trim() });
  ctx.store.set(ACKS, Object.fromEntries(all));
}

export function rules(ctx: Ctx): AlertRule[] {
  const toggles = ctx.store.get<Record<string, boolean>>(RULES) ?? {};
  return ctx.sample.alerts().rules.map((r) => (r.id in toggles ? { ...r, enabled: toggles[r.id] } : r));
}

/** False when the rule does not exist. */
export function setRuleEnabled(ctx: Ctx, id: string, enabled: boolean): boolean {
  if (!rules(ctx).some((r) => r.id === id)) return false;
  ctx.store.set(RULES, { ...(ctx.store.get<Record<string, boolean>>(RULES) ?? {}), [id]: enabled });
  return true;
}

/** The silences and windows in force. Read once per request: the sample module prunes expired silences as it answers. */
interface Suppressors {
  silences: Silence[];
  maintenance: MaintenanceWindow[];
}

export function suppressors(ctx: Ctx): Suppressors {
  const { silences, maintenance } = ctx.sample.alerts();
  return { silences, maintenance };
}

/** Which rule and target an incident stands for, whoever opened it. */
export function alertTarget(i: IncidentRow): { ruleId: string; serviceId: string; fromRule: boolean; isService: boolean } {
  const rule = parseSubject(i.subject);
  if (rule) return { ruleId: rule.ruleId, serviceId: rule.key, fromRule: true, isService: false };
  const isService = i.subject.startsWith('service:');
  // The stored rule set's ids for what the checkers raise: service down per project (r1/r2), node offline (r3).
  return { ruleId: isService ? (i.project === 'finvault' ? 'r2' : 'r1') : 'r3', serviceId: i.subject.slice(i.subject.indexOf(':') + 1), fromRule: false, isService };
}

/** The silence and the maintenance window covering an incident right now, if any. */
export function suppression(ctx: Ctx, i: IncidentRow, by: Suppressors = suppressors(ctx)): { silenceId: string | null; maintenanceId: string | null } {
  const { ruleId, serviceId } = alertTarget(i);
  return {
    silenceId: by.silences.find((s) => (s.kind === 'alert' ? s.targetId === i.id : s.targetId === ruleId))?.id ?? null,
    maintenanceId: by.maintenance.find((w) => windowCovers(w, { project: i.project, serviceId }, ctx.clock()))?.id ?? null,
  };
}

function activeFromIncidents(ctx: Ctx, now: number, by: Suppressors, ruleSet: AlertRule[]): ActiveAlert[] {
  const acked = acks(ctx);
  return ctx.store
    .incidents(now)
    .filter((i) => i.endedAt === null)
    .map((i) => {
      const target = alertTarget(i);
      const rule = target.fromRule ? ruleSet.find((r) => r.id === target.ruleId) : undefined;
      const measured = rule ? currentReading(ctx, rule, target.serviceId) : null;
      const trend = measured
        ? measured.trend
        : target.isService
          ? ctx.store
              .lastChecks(target.serviceId, 40)
              .filter((c) => c.latencyMs !== null)
              .map((c) => c.latencyMs as number)
          : [];
      return {
        id: i.id,
        ruleId: target.ruleId,
        severity: i.severity,
        project: i.project,
        serviceId: target.serviceId,
        title: i.title,
        description: i.note,
        rule: rule
          ? formatCondition(rule.condition)
          : target.isService
            ? `heartbeat{service="${target.serviceId}"} == 0 for ${ctx.config.health.failuresForIncident} checks`
            : `no heartbeat from ${target.serviceId} for 10 s`,
        startedAt: iso(i.startedAt),
        durationSeconds: seconds(now - i.startedAt),
        value: measured ? measured.value : target.isService ? 'timeout' : 'offline',
        trend,
        acknowledged: acked.has(i.id),
        acknowledgedAt: acked.get(i.id)?.at ?? null,
        ...suppression(ctx, i, by),
        notes: ackNotes(i.id, acked.get(i.id)),
      };
    });
}

export function activeAlerts(ctx: Ctx): ActiveAlert[] {
  if (!ctx.live.logs) {
    const acked = acks(ctx);
    return ctx.sample.alerts().active.map((a) => ({ ...a, acknowledged: a.acknowledged || acked.has(a.id) }));
  }
  return activeFromIncidents(ctx, ctx.clock(), suppressors(ctx), rules(ctx));
}

export function alerts(ctx: Ctx): AlertsData {
  if (!ctx.live.logs) return { ...ctx.sample.alerts(), active: activeAlerts(ctx), rules: rules(ctx) };
  const now = ctx.clock();
  const base = ctx.sample.alerts();
  const active = activeFromIncidents(ctx, now, base, rules(ctx));
  const acked = acks(ctx);
  const month = ctx.store.incidents(now - 30 * DAY_MS);
  const resolved = month.filter((i) => i.endedAt !== null);
  const resolved24h = resolved.filter((i) => (i.endedAt as number) >= now - DAY_MS).length;
  const mttr = resolved.length ? resolved.reduce((sum, i) => sum + ((i.endedAt as number) - i.startedAt), 0) / resolved.length / 60_000 : 0;
  return {
    // Silences, maintenance windows and escalation policies are the stored set the dashboard edits.
    ...base,
    // The services a maintenance window can be scoped to are the monitored ones.
    services: ctx.live.services ? ctx.config.health.targets.map(({ id, name, project }) => ({ id, name, project })) : base.services,
    summary: {
      critical: active.filter((a) => a.severity === 'critical').length,
      warning: active.filter((a) => a.severity === 'warning').length,
      muted: base.silences.length,
      inMaintenance: active.filter((a) => a.maintenanceId).length,
      resolved24h,
      // Nobody resolves incidents by hand yet: every resolution is the condition clearing.
      resolvedAuto24h: resolved24h,
      mttrMinutes: Math.round(mttr),
    },
    active,
    rules: rules(ctx),
    history: month.map((i) => ({
      id: i.id,
      ...(i.endedAt === null ? { alertId: i.id } : {}),
      open: i.endedAt === null,
      title: i.title,
      project: i.project,
      severity: i.severity,
      startedAt: iso(i.startedAt),
      durationSeconds: seconds((i.endedAt ?? now) - i.startedAt),
      notes: ackNotes(i.id, acked.get(i.id)),
    })),
  };
}
