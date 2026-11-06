/** Shell, Overview, Heartbeats and the two project pages: compositions of the other views. */
import { networkInterfaces, uptime } from 'node:os';
import type { FinVaultData, HeartbeatsData, HostInfo, NavCounts, NexusInfraData, OverviewData, TimeRange } from '../contract.js';
import { RANGE_MS } from '../duration.js';
import { activeAlerts, incidents } from './alerts.js';
import type { Ctx } from './ctx.js';
import { recentEvents } from './logs.js';
import { colored, storedSeries, summed } from './metrics.js';
import { nodes } from './nodes.js';
import { percentile, round } from './series.js';
import { monitors, services, summaryFor } from './services.js';

function firstAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '127.0.0.1';
}

/** The machine the collector runs on — always real. */
export function host(ctx: Ctx): HostInfo {
  const list = nodes(ctx);
  return {
    name: ctx.config.host.name,
    address: ctx.config.host.address ?? firstAddress(),
    uptimeSeconds: Math.round(uptime()),
    nodesConnected: list.filter((n) => n.status !== 'down').length,
    online: true,
  };
}

export function navCounts(ctx: Ctx): NavCounts {
  const list = services(ctx);
  return {
    openAlerts: activeAlerts(ctx).length,
    services: { nexusinfra: list.filter((s) => s.project === 'nexusinfra').length, finvault: list.filter((s) => s.project === 'finvault').length },
  };
}

function alertSummary(ctx: Ctx): string {
  const active = activeAlerts(ctx);
  if (active.length === 0) return 'all clear';
  return active.slice(0, 3).map((a) => a.title.replace(/ is not responding$/, ' down').replace(/ is slow$/, ' slow')).join(' · ');
}

export function overview(ctx: Ctx, range: TimeRange): OverviewData {
  const base = ctx.sample.overview();
  const list = services(ctx);
  const now = ctx.clock();

  let p95Ms = base.kpis.p95Ms;
  let p95Trend = base.kpis.p95Trend;
  let requests = base.requests;
  if (ctx.live.requests) {
    p95Trend = summarisedP95(ctx, range);
    p95Ms = p95Trend.length ? Math.round(p95Trend[p95Trend.length - 1]) : 0;
    requests = { rps: summed(ctx, 'requests', range, 60), errors5xx: summed(ctx, 'errors5xx', range, 60) };
  } else if (ctx.live.services) {
    // No scrape configured: the p95 of the health checks' own latency is the best measure there is.
    const ms = ctx.config.health.targets.flatMap((t) => ctx.store.checks(t.id, now - RANGE_MS[range]).filter((c) => c.latencyMs !== null).map((c) => c.latencyMs as number));
    p95Ms = percentile(ms, 95) ?? 0;
    p95Trend = ctx.config.health.targets.length ? hourlyP95(ctx, now) : [];
  }

  const active = activeAlerts(ctx);
  return {
    kpis: {
      ...base.kpis,
      servicesUp: list.filter((s) => s.status === 'up').length,
      servicesTotal: list.length,
      servicesSlow: list.filter((s) => s.status === 'slow').length,
      servicesDown: list.filter((s) => s.status === 'down').length,
      p95Ms,
      p95Trend,
      openAlerts: active.length,
      openAlertsSummary: ctx.live.logs ? alertSummary(ctx) : base.kpis.openAlertsSummary,
    },
    services: list,
    events: recentEvents(ctx),
    cpuByNode: ctx.live.nodeMetrics ? colored(storedSeries(ctx, 'cpu', range, 60)) : base.cpuByNode,
    requests,
    topupsPerHour: base.topupsPerHour,
    paymentsPerDay: base.paymentsPerDay,
  };
}

/** Worst p95 across scraped services per point. */
function summarisedP95(ctx: Ctx, range: TimeRange): number[] {
  const parts = storedSeries(ctx, 'latency_p95', range, 30);
  if (parts.length === 0) return [];
  const length = Math.max(...parts.map((p) => p.values.length));
  return Array.from({ length }, (_, i) => round(Math.max(...parts.map((p) => p.values[i - (length - p.values.length)] ?? 0)), 1));
}

/** p95 of check latency per hour over the last 24 hours, from the first hour with data. */
function hourlyP95(ctx: Ctx, now: number): number[] {
  const out: number[] = [];
  for (let h = 23; h >= 0; h--) {
    const from = now - (h + 1) * 3_600_000;
    const ms = ctx.config.health.targets.flatMap((t) =>
      ctx.store.checks(t.id, from).filter((c) => c.ts < from + 3_600_000 && c.latencyMs !== null).map((c) => c.latencyMs as number),
    );
    const p = percentile(ms, 95);
    if (p !== null) out.push(p);
    else if (out.length) out.push(out[out.length - 1]);
  }
  return out;
}

export function heartbeats(ctx: Ctx): HeartbeatsData {
  return { nodes: nodes(ctx), monitors: monitors(ctx), incidents: incidents(ctx) };
}

export function nexusInfra(ctx: Ctx): NexusInfraData {
  const base = ctx.sample.nexusInfra();
  const nodeList = nodes(ctx);
  const components = ctx.live.services ? services(ctx).filter((s) => s.project === 'nexusinfra') : base.components;
  if (!ctx.live.nodes) return { ...base, components };
  const online = nodeList.filter((n) => n.status !== 'down');
  const notOk = nodeList.filter((n) => n.status !== 'up');
  const cpu = nodeList.flatMap((n) => n.gauges.filter((g) => g.label === 'CPU').map((g) => g.pct));
  return {
    ...base,
    kpis: {
      ...base.kpis,
      nodesOnline: online.length,
      nodesTotal: nodeList.length,
      nodeNote: notOk.length ? notOk.map((n) => `${n.name} ${n.status === 'down' ? 'offline' : 'slow'}`).join(', ') : 'all nodes healthy',
      cpuPct: cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : base.kpis.cpuPct,
    },
    nodes: nodeList,
    components,
  };
}

export function finVault(ctx: Ctx): FinVaultData {
  const base = ctx.sample.finVault();
  if (!ctx.live.services) return base;
  const now = ctx.clock();
  const targets = ctx.config.health.targets.filter((t) => t.project === 'finvault');
  return {
    ...base,
    services: targets.map((t) => {
      const service = summaryFor(ctx, t);
      const ms = ctx.store.checks(t.id, now - 86_400_000).filter((c) => c.latencyMs !== null).map((c) => c.latencyMs as number);
      const p95 = percentile(ms, 95);
      // Request rates for FinVault services need FinVault's gateway events (not consumed yet).
      return { service, p95: p95 === null ? 'timeout' : `${Math.round(p95)} ms`, rps: null, errorPct: null };
    }),
  };
}
