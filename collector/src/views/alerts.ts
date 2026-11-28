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

function acknowledged(ctx: Ctx): Set<string> {
  return new Set(ctx.store.get<string[]>(ACKS) ?? []);
}

const LIVE = 'alerts.live';
/** What people did to live alerts: when each was acknowledged, and the notes (oldest first). */
interface LiveAlertState {
  acknowledgedAt: Record<string, string>;
  notes: Record<string, AlertNote[]>;
}
const liveState = (ctx: Ctx): LiveAlertState => ({ acknowledgedAt: {}, notes: {}, ...ctx.store.get<LiveAlertState>(LIVE) });

function addLiveNote(ctx: Ctx, state: LiveAlertState, id: string, kind: AlertNote['kind'], text: string): void {
  const notes = state.notes[id] ?? [];
  state.notes[id] = [...notes, { id: `${id}-n${notes.length + 1}`, kind, text: text.trim(), at: iso(ctx.clock()) }];
}

function openIncident(ctx: Ctx, id: string): IncidentRow {
  const i = ctx.store.incidents(0).find((x) => x.id === id && x.endedAt === null);
  if (!i) throw new HttpError(404, `Alert ${id} is not active`);
  return i;
}

/**
 * Sample alerts are acknowledged in the sample module and snapshotted. Live ones keep the time and the
 * note in the store; 404 when the alert is not open.
 */
export function acknowledge(ctx: Ctx, id: string, note = ''): void {
  if (!ctx.live.logs) {
    ctx.sample.acknowledgeAlert(id, note);
    saveState(ctx.store);
  } else {
    openIncident(ctx, id);
    const state = liveState(ctx);
    if (!state.acknowledgedAt[id]) {
      state.acknowledgedAt[id] = iso(ctx.clock());
      addLiveNote(ctx, state, id, 'acknowledged', note);
      ctx.store.set(LIVE, state);
    }
  }
  const acks = acknowledged(ctx);
  acks.add(id);
  ctx.store.set(ACKS, [...acks]);
}

/**
 * "Resolve" on a live alert: closes its incident now, with the note. If the source still fails, the
 * checker opens a new incident on its next check — resolving does not hide a real outage.
 */
export function resolveLive(ctx: Ctx, id: string, note = ''): void {
  const i = openIncident(ctx, id);
  const state = liveState(ctx);
  addLiveNote(ctx, state, id, 'resolved', note);
  ctx.store.set(LIVE, state);
  ctx.store.closeIncidents(i.subject, ctx.clock());
}

/** Live: the open alerts a silence may point at. */
export function openAlertTargets(ctx: Ctx): { id: string; title: string; ruleId: string }[] {
  return ctx.store.incidents(0).filter((i) => i.endedAt === null).map((i) => ({ id: i.id, title: i.title, ruleId: alertTarget(i).ruleId }));
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
  if (!ctx.live.logs) return { silences, maintenance };
  // Live: an "until resolved" silence ends once nothing it covers is open any more.
  const open = openAlertTargets(ctx);
  const done = silences.filter((s) => s.endsAt === null && (s.kind === 'alert' ? !open.some((a) => a.id === s.targetId) : !open.some((a) => a.ruleId === s.targetId)));
  if (done.length) {
    for (const s of done) ctx.sample.deleteSilence(s.id);
    saveState(ctx.store);
  }
  return { silences: silences.filter((s) => !done.includes(s)), maintenance };
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
  const acks = acknowledged(ctx);
  const live = liveState(ctx);
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
        acknowledged: acks.has(i.id),
        acknowledgedAt: live.acknowledgedAt[i.id] ?? null,
        ...suppression(ctx, i, by),
        notes: live.notes[i.id] ?? [],
      };
    });
}

export function activeAlerts(ctx: Ctx): ActiveAlert[] {
  if (!ctx.live.logs) {
    const acks = acknowledged(ctx);
    return ctx.sample.alerts().active.map((a) => ({ ...a, acknowledged: a.acknowledged || acks.has(a.id) }));
  }
  return activeFromIncidents(ctx, ctx.clock(), suppressors(ctx), rules(ctx));
}

export function alerts(ctx: Ctx): AlertsData {
  if (!ctx.live.logs) return { ...ctx.sample.alerts(), active: activeAlerts(ctx), rules: rules(ctx) };
  const now = ctx.clock();
  // Prunes finished "until resolved" silences before anything reads them.
  const by = suppressors(ctx);
  const base = { ...ctx.sample.alerts(), silences: by.silences };
  const active = activeFromIncidents(ctx, now, by, rules(ctx));
  const month = ctx.store.incidents(now - 30 * DAY_MS);
  const notesFor = liveState(ctx).notes;
  const resolved = month.filter((i) => i.endedAt !== null);
  const resolved24h = resolved.filter((i) => (i.endedAt as number) >= now - DAY_MS).length;
  const mttr = resolved.length ? resolved.reduce((sum, i) => sum + ((i.endedAt as number) - i.startedAt), 0) / resolved.length / 60_000 : 0;
  return {
    // Silences, maintenance windows and escalation policies are the stored set the dashboard edits.
    ...base,
    // The services a maintenance window can be scoped to are the monitored ones.
    services: ctx.live.logs ? ctx.config.health.targets.map(({ id, name, project }) => ({ id, name, project })) : base.services,
    summary: {
      critical: active.filter((a) => a.severity === 'critical').length,
      warning: active.filter((a) => a.severity === 'warning').length,
      muted: base.silences.length,
      inMaintenance: active.filter((a) => a.maintenanceId).length,
      resolved24h,
      // Resolved without a person's "Resolve": the condition cleared on its own.
      resolvedAuto24h: resolved.filter((i) => (i.endedAt as number) >= now - DAY_MS && !(notesFor[i.id] ?? []).some((n) => n.kind === 'resolved')).length,
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
      notes: notesFor[i.id] ?? [],
    })),
  };
}
