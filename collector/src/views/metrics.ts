/** The Metrics page and the Overview charts — from stored samples where a source feeds them. */
import type { ChartColor, MetricData, MetricId, MetricsOverview, Series, TimeRange } from '../contract.js';
import { RANGE_MS } from '../duration.js';
import type { Ctx } from './ctx.js';
import { round, seriesByName, summedSeries } from './series.js';

const POINTS = 90;
const PALETTE: ChartColor[] = ['nx', 'sky', 'vi', 'fv', 'warn', 'ok', 'down'];

/** Which stored metric feeds each chart, and the query text shown under it. */
const STORED: Partial<Record<MetricId, { metric: string; query: string; live: (ctx: Ctx) => boolean }>> = {
  cpu: { metric: 'cpu', query: 'heartbeat.node resources.cpuPercent', live: (c) => c.live.nodeMetrics },
  memory: { metric: 'memory', query: 'heartbeat.node resources.ramUsedMb / ramTotalMb', live: (c) => c.live.nodeMetrics },
  disk: { metric: 'disk', query: 'heartbeat.node resources.diskUsedGb / diskTotalGb', live: (c) => c.live.nodeMetrics },
  queues: { metric: 'queues', query: 'nexusinfra_dead_letters, nexusinfra_outbox_pending', live: (c) => c.live.queues },
  // network: no source measures it yet → sample data.
};

export function colored(series: { name: string; values: number[] }[]): Series[] {
  return series.map((s, i) => ({ name: s.name, color: PALETTE[i % PALETTE.length], values: s.values.map((v) => round(v, 2)) }));
}

export function storedSeries(ctx: Ctx, metric: string, range: TimeRange, points: number): { name: string; values: number[] }[] {
  const now = ctx.clock();
  const from = now - RANGE_MS[range];
  return seriesByName(ctx.store.samples(metric, from, now), from, now, points);
}

export function summed(ctx: Ctx, metric: string, range: TimeRange, points: number): number[] {
  const now = ctx.clock();
  const from = now - RANGE_MS[range];
  return summedSeries(ctx.store.samples(metric, from, now), from, now, points).map((v) => round(v, 2));
}

export function metric(ctx: Ctx, id: MetricId, range: TimeRange): MetricData {
  const base = ctx.sample.metric(id);
  const stored = STORED[id];
  if (!stored || !stored.live(ctx)) return base;
  const series = colored(storedSeries(ctx, stored.metric, range, POINTS));
  const top = Math.max(0, ...series.flatMap((s) => s.values));
  // Percent charts keep 100; counts get a y axis that fits them.
  const max = base.unit === '%' ? 100 : Math.max(10, Math.ceil((top * 1.2) / 10) * 10);
  return { ...base, query: stored.query, max, series };
}

const last = (values: number[]) => values[values.length - 1];

/** "+2 pt" / "-8%" style delta between the start and the end of a trend. */
function delta(values: number[], unit: string): string {
  if (values.length < 2) return '±0';
  const d = last(values) - values[0];
  const text = `${d >= 0 ? '+' : '-'}${round(Math.abs(d), Math.abs(d) < 10 ? 1 : 0)}`;
  return unit === '%' ? `${text} pt` : `${text}${unit ? ` ${unit}` : ''}`;
}

export function metricsOverview(ctx: Ctx, range: TimeRange): MetricsOverview {
  const base = ctx.sample.metricsOverview();
  const summaries = base.summaries.map((s) => {
    if (s.title === 'CPU total' && ctx.live.nodeMetrics) {
      const trend = averaged(ctx, 'cpu', range);
      return trend.length ? { ...s, value: String(round(last(trend))), delta: delta(trend, '%'), trend } : { ...s, value: '–', delta: 'no data yet', trend: [] };
    }
    if (s.title === 'Containers running' && ctx.live.requests) {
      const trend = summed(ctx, 'containers', range, 40);
      return trend.length ? { ...s, value: String(round(last(trend))), delta: delta(trend, ''), trend } : { ...s, value: '–', delta: 'no data yet', trend: [] };
    }
    if (s.title === 'Queue depth' && ctx.live.queues) {
      const trend = summed(ctx, 'queues', range, 40);
      const now = trend.length ? last(trend) : null;
      return now === null
        ? { ...s, value: '–', delta: 'no data yet', trend: [] }
        : { ...s, value: String(round(now)), delta: delta(trend, 'msg'), tone: now > 0 ? ('down' as const) : ('ok' as const), trend };
    }
    return s;
  });
  return { summaries, topContainers: base.topContainers };
}

/** Mean over series per point (e.g. CPU across nodes). */
function averaged(ctx: Ctx, metric: string, range: TimeRange): number[] {
  const parts = storedSeries(ctx, metric, range, 40);
  if (parts.length === 0) return [];
  const length = Math.max(...parts.map((p) => p.values.length));
  return Array.from({ length }, (_, i) => {
    const vals = parts.map((p) => p.values[i - (length - p.values.length)]).filter((v): v is number => v !== undefined);
    return round(vals.reduce((a, b) => a + b, 0) / vals.length, 1);
  });
}
