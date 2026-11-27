/** Shell, Overview, Heartbeats and the two project pages: compositions of the other views. */
import { networkInterfaces, uptime } from 'node:os';
import type { FinVaultData, HeartbeatsData, HostInfo, NavCounts, NexusInfraData, OverviewData, TimeRange } from '../contract.js';
import { RANGE_MS } from '../duration.js';
import { activeAlerts, incidents } from './alerts.js';
import { finVaultBusiness, nexusInfraPayments, overviewMoney } from './business.js';
import { hostName, nexusInfraContainers } from './containers.js';
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
    name: hostName(ctx),
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

  // With any source, nothing below is sample data: unmeasured parts are 0 / empty.
  const real = ctx.live.logs;
  let p95Ms = real ? 0 : base.kpis.p95Ms;
  let p95Trend = real ? [] : base.kpis.p95Trend;
  let requests = real ? { rps: [], errors5xx: [] } : base.requests;
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
  const money = real ? overviewMoney(ctx) : null;
  return {
    kpis: {
      ...base.kpis,
      ...(money ? { topupsToday: money.topupsToday, topupsTrend: money.topupsTrend, paymentsMonthEur: money.paymentsMonthEur, paymentsTrend: money.paymentsTrend } : {}),
      // Without a bus nothing measures money: unknown, not 0.
      ...(real && !ctx.live.business ? { topupsToday: null, topupsTrend: [], paymentsMonthEur: null, paymentsTrend: [] } : {}),
      servicesUp: list.filter((s) => s.status === 'up').length,
      servicesTotal: list.length,
      servicesSlow: list.filter((s) => s.status === 'slow').length,
      servicesDown: list.filter((s) => s.status === 'down').length,
      p95Ms,
      p95Trend,
      openAlerts: active.length,
      openAlertsSummary: real ? alertSummary(ctx) : base.kpis.openAlertsSummary,
    },
    services: list,
    events: recentEvents(ctx),
    cpuByNode: real ? colored(storedSeries(ctx, 'cpu', range, 60)) : base.cpuByNode,
    requests,
    topupsPerHour: money ? money.topupsPerHour : base.topupsPerHour,
    paymentsPerDay: money ? money.paymentsPerDay : base.paymentsPerDay,
    checkIntervalSeconds: !real
      ? base.checkIntervalSeconds
      : ctx.config.health.targets.length ? Math.round(Math.min(...ctx.config.health.targets.map((t) => t.intervalMs)) / 1000) : null,
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
  const sampled = ctx.sample.nexusInfra();
  if (!ctx.live.logs) return sampled;
  // Live: every figure from a source; one without a source reads 0 / empty, never the sample's.
  const pay = nexusInfraPayments(ctx);
  const base: NexusInfraData = {
    kpis: { ...sampled.kpis, nodesOnline: 0, nodesTotal: 0, nodeNote: 'no node source', cpuPct: 0, memoryUsedGb: 0, memoryTotalGb: 0, paymentsMonthEur: pay.paymentsMonthEur },
    nodes: [],
    containers: [],
    components: [],
    paymentsPerDay: pay.paymentsPerDay,
    payments: pay.payments,
  };
  const nodeList = nodes(ctx);
  const components = services(ctx).filter((s) => s.project === 'nexusinfra');
  if (!ctx.live.nodes) return { ...base, components, kpis: { ...base.kpis, ...containersLive(ctx) }, containers: nexusInfraContainers(ctx) };
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
      cpuPct: cpu.length ? Math.round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : 0,
      ...memoryLive(ctx),
      ...containersLive(ctx),
    },
    nodes: nodeList,
    components,
    containers: nexusInfraContainers(ctx),
  };
}

/** Memory over every node that reports it in its heartbeat (GB); 0 / 0 when none does. */
function memoryLive(ctx: Ctx): { memoryUsedGb: number; memoryTotalGb: number } {
  let used = 0;
  let total = 0;
  for (const n of ctx.store.sources('node')) {
    const r = n.detail.resources as { ramUsedMb?: number; ramTotalMb?: number } | undefined;
    if (typeof r?.ramUsedMb === 'number' && typeof r.ramTotalMb === 'number') {
      used += r.ramUsedMb;
      total += r.ramTotalMb;
    }
  }
  return { memoryUsedGb: Math.round(used / 1024), memoryTotalGb: Math.round(total / 1024) };
}

/**
 * Container counts from the node agents' scrape (running / all states). The per-container rows need
 * the agent's own API, which takes NexusInfra's internal token, so the list stays empty.
 */
function containersLive(ctx: Ctx): Pick<NexusInfraData['kpis'], 'containersRunning' | 'containersTotal' | 'containersNote'> {
  if (ctx.live.docker) {
    // The Docker host sees every NexusInfra container: its stacks and the customer servers.
    const list = nexusInfraContainers(ctx);
    const running = list.filter((c) => c.state === 'running').length;
    const down = list.filter((c) => c.state !== 'running').map((c) => c.name);
    return {
      containersRunning: running,
      containersTotal: list.length,
      containersNote: list.length === 0 ? 'no container seen yet' : down.length ? `${down.length} not running (${down.slice(0, 2).join(', ')}${down.length > 2 ? ', …' : ''})` : 'all running',
    };
  }
  const running = ctx.store.latestSamples('containers').reduce((a, s) => a + s.value, 0);
  const all = ctx.store.latestSamples('containers_total').reduce((a, s) => a + s.value, 0);
  const total = Math.max(all, running);
  return {
    containersRunning: running,
    containersTotal: total,
    containersNote: !ctx.store.hasSamples('containers') ? 'no node agent scraped' : total > running ? `${total - running} not running` : 'all running',
  };
}

export function finVault(ctx: Ctx): FinVaultData {
  const sampled = ctx.sample.finVault();
  if (!ctx.live.logs) return sampled;
  const base: FinVaultData = { ...sampled, ...finVaultBusiness(ctx), services: [] };
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
