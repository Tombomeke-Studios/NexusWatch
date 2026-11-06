/** Services, monitors and the service detail page — from health checks when targets are configured. */
import type { HealthTarget } from '../config.js';
import type { HealthStatus, Monitor, ServiceDetail, ServiceSummary } from '../contract.js';
import { trailingFailures } from '../sources/health.js';
import type { Check } from '../store.js';
import { DAY_MS, iso, seconds, type Ctx } from './ctx.js';
import { percentile, round } from './series.js';

const BEATS = 48;
const CHECKS = 120;
const RESPONSE_BUCKETS = 96;
const DAYS = 60;

const answered = (checks: Check[]) => checks.filter((c) => c.latencyMs !== null).map((c) => c.latencyMs as number);

/** Share of checks that got a good answer (up or slow), 0–100. 100 when nothing was checked yet. */
export function uptimePct(checks: Check[]): number {
  if (checks.length === 0) return 100;
  return round((checks.filter((c) => c.status !== 'down').length / checks.length) * 100, 2);
}

const RANK: Record<HealthStatus, number> = { up: 0, slow: 1, down: 2 };
const worst = (a: HealthStatus, b: HealthStatus) => (RANK[a] >= RANK[b] ? a : b);

/** Worst status per calendar day (UTC), oldest first, starting at the first day with a check. */
export function dailyStatus(checks: Check[], now: number, days = DAYS): HealthStatus[] {
  const today = Math.floor(now / DAY_MS);
  const out: (HealthStatus | null)[] = new Array(days).fill(null);
  for (const c of checks) {
    const i = days - 1 - (today - Math.floor(c.ts / DAY_MS));
    if (i >= 0 && i < days) out[i] = out[i] ? worst(out[i]!, c.status) : c.status;
  }
  const first = out.findIndex((s) => s !== null);
  if (first < 0) return [];
  // A day without checks after monitoring began counts as unknown → shown as the previous day's status.
  const filled: HealthStatus[] = [];
  for (const s of out.slice(first)) filled.push(s ?? filled[filled.length - 1]);
  return filled;
}

/** Average answered latency per bucket over [from, to]; null = checks happened but none answered. */
export function responseTimes(checks: Check[], from: number, to: number, buckets = RESPONSE_BUCKETS): (number | null)[] {
  const width = (to - from) / buckets;
  const slots: Check[][] = Array.from({ length: buckets }, () => []);
  for (const c of checks) {
    if (c.ts < from || c.ts > to) continue;
    slots[Math.min(buckets - 1, Math.floor((c.ts - from) / width))].push(c);
  }
  const first = slots.findIndex((s) => s.length > 0);
  if (first < 0) return [];
  return slots.slice(first).map((s) => {
    const ms = answered(s);
    return ms.length ? round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
  });
}

export function summaryFor(ctx: Ctx, t: HealthTarget): ServiceSummary {
  const now = ctx.clock();
  const recent = ctx.store.lastChecks(t.id, BEATS);
  const last = recent[recent.length - 1];
  return {
    id: t.id,
    name: t.name,
    project: t.project,
    port: t.port,
    // Not checked yet: no answer so far, which is reported like any other missing answer.
    status: last?.status ?? 'down',
    latencyMs: last?.latencyMs ?? null,
    uptimePct: uptimePct(ctx.store.checks(t.id, now - 30 * DAY_MS)),
    beats: recent.map((c) => c.status),
  };
}

export function services(ctx: Ctx): ServiceSummary[] {
  if (!ctx.live.services) return ctx.sample.services;
  return ctx.config.health.targets.map((t) => summaryFor(ctx, t));
}

export function serviceById(ctx: Ctx, id: string): ServiceSummary | undefined {
  return services(ctx).find((s) => s.id === id);
}

export function monitors(ctx: Ctx): Monitor[] {
  if (!ctx.live.services) return ctx.sample.heartbeats().monitors;
  const now = ctx.clock();
  return ctx.config.health.targets.map((t) => {
    const s = summaryFor(ctx, t);
    const day = ctx.store.checks(t.id, now - DAY_MS);
    const ms = answered(day);
    return {
      id: `mon_${t.id}`,
      serviceId: t.id,
      name: t.name,
      project: t.project,
      target: t.url,
      uptimePct: s.uptimePct,
      status: s.status,
      // 0 only when no check answered in 24h; see TODO (make it nullable in the contract).
      avgLatencyMs: ms.length ? round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0,
      nowLatencyMs: s.latencyMs,
      days: dailyStatus(ctx.store.checks(t.id, now - DAYS * DAY_MS), now),
    };
  });
}

export function serviceDetail(ctx: Ctx, id: string): ServiceDetail | null {
  if (!ctx.live.services) return ctx.sample.serviceDetail(id);
  const t = ctx.config.health.targets.find((x) => x.id === id);
  if (!t) return null;
  const now = ctx.clock();
  const service = summaryFor(ctx, t);
  const day = ctx.store.checks(t.id, now - DAY_MS);
  const month = ctx.store.checks(t.id, now - 30 * DAY_MS);
  const last = ctx.store.lastChecks(t.id, CHECKS);
  const latest = last[last.length - 1];
  const failures = trailingFailures(last);
  const downSince = failures > 0 ? last[last.length - failures].ts : null;
  const subject = `service:${t.id}`;
  const incidents = ctx.store.incidents(now - 30 * DAY_MS, subject);
  const ms = answered(day);
  const firstCheck = ctx.store.firstCheckAt(t.id);

  const timeline: ServiceDetail['timeline'] = [];
  for (const inc of incidents) {
    if (inc.endedAt) timeline.push({ tone: 'ok', title: `Outage resolved (${Math.round((inc.endedAt - inc.startedAt) / 60_000)} min)`, when: iso(inc.endedAt) });
    timeline.push({ tone: 'error', title: inc.title, when: iso(inc.startedAt) });
  }
  if (latest && latest.status !== 'down') timeline.unshift({ tone: 'ok', title: 'Latest check passing', when: iso(latest.ts) });
  if (firstCheck !== null) timeline.push({ tone: 'nx', title: 'Monitoring started', when: iso(firstCheck) });

  return {
    service,
    target: t.url,
    intervalSeconds: seconds(t.intervalMs),
    downSince: downSince === null ? null : iso(downSince),
    failure: failures > 0 ? `${failures} check${failures === 1 ? '' : 's'} failed in a row · error: ${latest.note}` : null,
    kpis: {
      uptime24h: uptimePct(day),
      downtime24hSeconds: seconds(day.filter((c) => c.status === 'down').length * t.intervalMs),
      uptime30d: uptimePct(month),
      incidents30d: incidents.length,
      avgLatencyMs: ms.length ? round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0,
      p95LatencyMs: percentile(ms, 95) ?? 0,
      lastCheckAt: latest ? iso(latest.ts) : iso(now),
      lastCheckNote: latest?.note ?? 'not checked yet',
      // Container restarts need the agent; not measured yet.
      restarts24h: 0,
    },
    responseTimes: responseTimes(day, now - DAY_MS, now),
    checks: last.map((c) => c.status),
    // Dependency chains need topology the collector does not have yet.
    dependencies: [],
    settings: [
      { label: 'Type', value: 'HTTP GET' },
      { label: 'Interval', value: `${seconds(t.intervalMs)} s` },
      { label: 'Timeout', value: `${t.timeoutMs / 1000} s` },
      { label: 'Expected', value: '2xx' },
      { label: 'Slow above', value: `${ctx.config.health.slowMs} ms` },
      { label: 'Incident after', value: `${ctx.config.health.failuresForIncident} failed checks` },
    ],
    logs: ctx.store.logs({ from: 0, to: now, serviceId: t.id }, 20),
    timeline,
  };
}
