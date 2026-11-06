/**
 * Incidents and alerts. With a live source, every open incident is an active alert (the health
 * checker and the heartbeat tracker open them); rule *evaluation* is not built yet, so the rule
 * list itself stays the sample one. Acknowledgements and rule toggles are stored either way.
 */
import type { ActiveAlert, AlertRule, AlertsData, Incident } from '../contract.js';
import type { IncidentRow } from '../store.js';
import { DAY_MS, iso, seconds, type Ctx } from './ctx.js';

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

export function acknowledge(ctx: Ctx, id: string): void {
  const acks = acknowledged(ctx);
  acks.add(id);
  ctx.store.set(ACKS, [...acks]);
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

function activeFromIncidents(ctx: Ctx, now: number): ActiveAlert[] {
  const acks = acknowledged(ctx);
  return ctx.store
    .incidents(now)
    .filter((i) => i.endedAt === null)
    .map((i) => {
      const [kind, name] = [i.subject.slice(0, i.subject.indexOf(':')), i.subject.slice(i.subject.indexOf(':') + 1)];
      const isService = kind === 'service';
      const trend = isService
        ? ctx.store
            .lastChecks(name, 40)
            .filter((c) => c.latencyMs !== null)
            .map((c) => c.latencyMs as number)
        : [];
      return {
        id: i.id,
        severity: i.severity,
        project: i.project,
        serviceId: name,
        title: i.title,
        description: i.note,
        rule: isService ? `heartbeat{service="${name}"} == 0 for ${ctx.config.health.failuresForIncident} checks` : `no heartbeat from ${name} for 10 s`,
        startedAt: iso(i.startedAt),
        durationSeconds: seconds(now - i.startedAt),
        value: isService ? 'timeout' : 'offline',
        trend,
        acknowledged: acks.has(i.id),
      };
    });
}

export function activeAlerts(ctx: Ctx): ActiveAlert[] {
  if (!ctx.live.logs) {
    const acks = acknowledged(ctx);
    return ctx.sample.alerts().active.map((a) => ({ ...a, acknowledged: a.acknowledged || acks.has(a.id) }));
  }
  return activeFromIncidents(ctx, ctx.clock());
}

export function alerts(ctx: Ctx): AlertsData {
  const active = activeAlerts(ctx);
  if (!ctx.live.logs) return { ...ctx.sample.alerts(), active, rules: rules(ctx) };
  const now = ctx.clock();
  const month = ctx.store.incidents(now - 30 * DAY_MS);
  const resolved = month.filter((i) => i.endedAt !== null);
  const resolved24h = resolved.filter((i) => (i.endedAt as number) >= now - DAY_MS).length;
  const mttr = resolved.length ? resolved.reduce((sum, i) => sum + ((i.endedAt as number) - i.startedAt), 0) / resolved.length / 60_000 : 0;
  return {
    summary: {
      critical: active.filter((a) => a.severity === 'critical').length,
      warning: active.filter((a) => a.severity === 'warning').length,
      muted: 0,
      resolved24h,
      // Nobody resolves incidents by hand yet: every resolution is the check passing again.
      resolvedAuto24h: resolved24h,
      mttrMinutes: Math.round(mttr),
    },
    active,
    rules: rules(ctx),
    history: month.map((i) => ({ id: i.id, open: i.endedAt === null, title: i.title, project: i.project, startedAt: iso(i.startedAt), durationSeconds: seconds((i.endedAt ?? now) - i.startedAt) })),
  };
}
