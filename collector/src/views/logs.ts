/** The Logs page and the event feeds — from the store whenever any source writes logs. */
import type { LogEntry, LogQuery, LogsData } from '../contract.js';
import { RANGE_MS } from '../duration.js';
import type { Ctx } from './ctx.js';

const HISTOGRAM_BUCKETS = 48;

export function logs(ctx: Ctx, q: LogQuery): LogsData {
  if (!ctx.live.logs) return ctx.sample.logs(q);
  const now = ctx.clock();
  const filter = { from: now - RANGE_MS[q.range], to: now, text: q.query, levels: q.levels, project: q.project };
  return {
    total: ctx.store.countLogs(filter),
    histogram: ctx.store.logHistogram(filter, HISTOGRAM_BUCKETS),
    facets: {
      level: ctx.store.logFacet(filter, 'level'),
      service: ctx.store.logFacet(filter, 'service'),
      node: ctx.store.logFacet(filter, 'node'),
    },
    entries: ctx.store.logs(filter),
  };
}

/** Newest lines of any level, for the Overview's "Recent events". */
export function recentEvents(ctx: Ctx, limit = 7): LogEntry[] {
  if (!ctx.live.logs) return ctx.sample.overview().events;
  const now = ctx.clock();
  return ctx.store.logs({ from: now - RANGE_MS['24h'], to: now }, limit);
}
