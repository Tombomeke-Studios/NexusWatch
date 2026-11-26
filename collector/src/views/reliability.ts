/**
 * SLOs, incidents and the public status page from what the collector measured, when health checks
 * are configured. Declared incidents (POST /incidents) live in the reliability module's store and are
 * persisted; the collector's own incidents (health checks, heartbeat sources, rules) come from SQLite.
 *
 * - One availability SLO per monitored service: a check that answered (up or slow) is good, a check
 *   without an answer is bad. `NW_SLO_TARGET` (default 99.5) over 30 days.
 * - /status lists one component per monitored service, by its display name only — never a host,
 *   port, target or id. Its maintenance comes from the maintenance windows set on the Alerts page.
 */
import { overallStatus, toPublicStatus } from '@/lib/publicStatus';
import type {
  BurnWindow, CheckTally, IncidentDetail, IncidentsData, Maintenance, PublicIncident, Slo, SloData, StatusComponent, StatusPageData,
} from '../contract.js';
import { reliability, sample } from '../sample.js';
import type { Check, IncidentRow } from '../store.js';
import { alertTarget } from './alerts.js';
import { DAY_MS, iso, seconds, type Ctx } from './ctx.js';
import { dailyStatus } from './services.js';

const WINDOW_DAYS = 30;
const BURN_MINUTES: Record<BurnWindow, number> = { '5m': 5, '30m': 30, '1h': 60, '2h': 120, '6h': 360, '24h': 1440 };

export function tallyOf(checks: Check[]): CheckTally {
  const bad = checks.filter((c) => c.status === 'down').length;
  return { good: checks.length - bad, bad, unknown: 0 };
}

export function slosLive(ctx: Ctx): SloData {
  const now = ctx.clock();
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  return {
    slos: ctx.config.health.targets.map((t): Slo => {
      const checks = ctx.store.checks(t.id, today - (WINDOW_DAYS - 1) * DAY_MS);
      // Days before the first check are empty tallies: no data, never "all good".
      const daily = Array.from({ length: WINDOW_DAYS }, (_, i) => {
        const from = today - (WINDOW_DAYS - 1 - i) * DAY_MS;
        return tallyOf(checks.filter((c) => c.ts >= from && c.ts < from + DAY_MS));
      });
      const burnWindows = Object.fromEntries(
        (Object.keys(BURN_MINUTES) as BurnWindow[]).map((w) => [w, tallyOf(checks.filter((c) => c.ts > now - BURN_MINUTES[w] * 60_000))]),
      ) as Record<BurnWindow, CheckTally>;
      return {
        id: `slo_${t.id}`,
        serviceId: t.id,
        name: t.name,
        project: t.project,
        objective: `Health check answers within ${Math.round(t.timeoutMs / 1000)} s`,
        targetPct: ctx.config.sloTargetPct,
        windowDays: WINDOW_DAYS,
        window: tallyOf(checks),
        daily,
        burnWindows,
      };
    }),
  };
}

/** One of the collector's own incidents as an incident detail. Not public: nobody wrote a public text. */
function fromRow(ctx: Ctx, i: IncidentRow, now: number): IncidentDetail {
  const { serviceId } = alertTarget(i);
  const target = ctx.config.health.targets.find((t) => t.id === serviceId);
  const resolved = i.endedAt !== null;
  const opened = { id: `${i.id}-opened`, at: iso(i.startedAt), status: 'investigating' as const, message: i.note || i.title, author: 'NexusWatch', public: false };
  const closed = resolved ? [{ id: `${i.id}-resolved`, at: iso(i.endedAt as number), status: 'resolved' as const, message: 'Recovered on its own: the check answers again.', author: 'NexusWatch', public: false }] : [];
  return {
    id: i.id,
    title: i.title,
    severity: i.severity,
    status: resolved ? 'resolved' : 'investigating',
    summary: i.note || i.title,
    affected: [{ serviceId, name: target?.name ?? serviceId, project: target?.project ?? i.project }],
    startedAt: iso(i.startedAt),
    resolvedAt: resolved ? iso(i.endedAt as number) : null,
    durationSeconds: seconds((i.endedAt ?? now) - i.startedAt),
    public: false,
    publicTitle: i.title,
    updates: [...closed, opened],
    postmortem: null,
  };
}

export function incidentsLive(ctx: Ctx): IncidentsData {
  const now = ctx.clock();
  const own = ctx.store.incidents(now - 90 * DAY_MS).map((i) => fromRow(ctx, i, now));
  const list = [...reliability.incidents().incidents, ...own].sort(
    (a, b) => Number(b.status !== 'resolved') - Number(a.status !== 'resolved') || b.startedAt.localeCompare(a.startedAt),
  );
  const recent = list.filter((i) => now - Date.parse(i.startedAt) <= 30 * DAY_MS);
  const resolved = recent.filter((i) => i.status === 'resolved');
  return {
    incidents: list,
    summary: {
      open: list.filter((i) => i.status !== 'resolved').length,
      last30d: recent.length,
      mttrMinutes: resolved.length ? Math.round(resolved.reduce((sum, i) => sum + i.durationSeconds, 0) / resolved.length / 60) : null,
    },
  };
}

export function incidentLive(ctx: Ctx, id: string): IncidentDetail | null {
  const declared = reliability.incident(id);
  if (declared) return declared;
  const row = ctx.store.incidents(0).find((i) => i.id === id);
  return row ? fromRow(ctx, row, ctx.clock()) : null;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function statusLive(ctx: Ctx): StatusPageData {
  const now = ctx.clock();
  const targets = ctx.config.health.targets;
  const components = targets.map((t): { project: typeof t.project; serviceId: string; component: StatusComponent } => {
    const checks = ctx.store.checks(t.id, now - 90 * DAY_MS);
    const days = dailyStatus(checks, now, 90);
    const last = ctx.store.lastChecks(t.id, 1)[0];
    return {
      project: t.project,
      serviceId: t.id,
      component: {
        slug: slug(t.name),
        name: t.name,
        status: last ? toPublicStatus(last.status) : 'operational',
        uptimePct: checks.length ? Math.round((tallyOf(checks).good / checks.length) * 10_000) / 100 : null,
        days: [...new Array<null>(90 - days.length).fill(null), ...days],
      },
    };
  });
  const namesFor = (serviceId: string) => components.filter((c) => c.serviceId === serviceId).map((c) => c.component.name);

  const maintenance: Maintenance[] = sample.alerts().maintenance.flatMap((w, i) => {
    let start = Date.parse(w.startsAt);
    const length = w.durationMinutes * 60_000;
    if (w.recurrence === 'weekly') while (start + length <= now) start += 7 * DAY_MS;
    if (start + length <= now) return [];
    const affected = components.filter((c) => c.project === w.project && (w.serviceId === null || c.serviceId === w.serviceId)).map((c) => c.component.name);
    return [{ slug: `maintenance-${i + 1}`, title: w.title, description: '', startsAt: iso(start), endsAt: iso(start + length), components: affected }];
  });
  const inProgress = maintenance.some((m) => Date.parse(m.startsAt) <= now);

  // Only incidents someone declared public, with their public updates.
  const published = reliability.incidents().incidents.filter((i) => i.public);
  const toPublic = (d: IncidentDetail): PublicIncident => ({
    slug: d.id,
    title: d.publicTitle,
    status: d.status,
    impact: d.severity,
    startedAt: d.startedAt,
    resolvedAt: d.resolvedAt,
    components: [...new Set(d.affected.flatMap((a) => namesFor(a.serviceId)))],
    updates: d.updates.filter((u) => u.public).map((u) => ({ at: u.at, status: u.status, message: u.message })),
  });

  return {
    overall: overallStatus(components.map((c) => c.component.status), inProgress),
    updatedAt: iso(now),
    groups: (['nexusinfra', 'finvault'] as const)
      .map((project) => ({ project, name: project === 'nexusinfra' ? 'NexusInfra' : 'FinVault', components: components.filter((c) => c.project === project).map((c) => c.component) }))
      .filter((g) => g.components.length > 0),
    active: published.filter((i) => i.status !== 'resolved').map(toPublic),
    recent: published.filter((i) => i.status === 'resolved' && i.resolvedAt && now - Date.parse(i.resolvedAt) <= 14 * DAY_MS).map(toPublic),
    maintenance,
  };
}
