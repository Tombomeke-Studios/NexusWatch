/**
 * Every endpoint of docs/api.md, in one table. Adding an endpoint = one line here plus a view that
 * returns the type from contract.ts (falling back to the dashboard's sample generator while no
 * source feeds it). Paths are relative to `/api`.
 */
import type { CollectorHealth, LogLevel, MetricId, ProjectId } from './contract.js';
import { isRange, type Range } from './duration.js';
import { testChannel } from './notify/dispatch.js';
import { acknowledge, alerts, setRuleEnabled } from './views/alerts.js';
import type { Ctx } from './views/ctx.js';
import { logs } from './views/logs.js';
import { metric, metricsOverview } from './views/metrics.js';
import { finVault, heartbeats, host, navCounts, nexusInfra, overview } from './views/pages.js';
import { serviceDetail } from './views/services.js';
import { sampledRoutes } from './views/sampled.js';
import { settings, updateSettings, type SettingsPatch } from './views/settings.js';

/** An answer: JSON body (200), `null` (204), or an HttpError — directly or as a promise. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RouteInput {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
}

export type RouteHandler = (ctx: Ctx, input: RouteInput) => unknown;

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handle: RouteHandler;
}

const VERSION = '0.1.0';
const METRIC_IDS: MetricId[] = ['cpu', 'memory', 'disk', 'network', 'queues'];
const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'ok'];
const PROJECTS: ProjectId[] = ['nexusinfra', 'finvault'];

function range(q: RouteInput['query']): Range {
  const r = q.range ?? '24h';
  if (!isRange(r)) throw new HttpError(400, `range must be one of 1h, 24h, 7d, 30d`);
  return r;
}

export function collectorHealth(ctx: Ctx): CollectorHealth {
  const sources = ctx.tasks();
  return {
    status: sources.some((s) => s.lastError) ? 'degraded' : 'ok',
    version: VERSION,
    uptimeSeconds: Math.round((ctx.clock() - ctx.startedAt) / 1000),
    live: { ...ctx.live },
    sources,
  };
}

export const routes: Route[] = [
  { method: 'GET', path: '/health', handle: (ctx) => collectorHealth(ctx) },
  { method: 'GET', path: '/host', handle: (ctx) => host(ctx) },
  { method: 'GET', path: '/nav', handle: (ctx) => navCounts(ctx) },
  { method: 'GET', path: '/overview', handle: (ctx, { query }) => overview(ctx, range(query)) },
  { method: 'GET', path: '/metrics', handle: (ctx, { query }) => metricsOverview(ctx, range(query)) },
  {
    method: 'GET',
    path: '/metrics/:id',
    handle: (ctx, { params, query }) => {
      if (!METRIC_IDS.includes(params.id as MetricId)) throw new HttpError(404, `Metric ${params.id} not found`);
      return metric(ctx, params.id as MetricId, range(query));
    },
  },
  {
    method: 'GET',
    path: '/logs',
    handle: (ctx, { query }) => {
      const levels = (query.level ?? '').split(',').map((l) => l.trim()).filter(Boolean) as LogLevel[];
      if (levels.some((l) => !LEVELS.includes(l))) throw new HttpError(400, `level must be a comma list of ${LEVELS.join(', ')}`);
      const project = query.project || undefined;
      if (project && !PROJECTS.includes(project as ProjectId)) throw new HttpError(400, `project must be one of ${PROJECTS.join(', ')}`);
      return logs(ctx, { query: query.q ?? '', range: range(query), levels, project: project as ProjectId | undefined });
    },
  },
  { method: 'GET', path: '/heartbeats', handle: (ctx) => heartbeats(ctx) },
  { method: 'GET', path: '/alerts', handle: (ctx) => alerts(ctx) },
  {
    method: 'POST',
    path: '/alerts/:id/ack',
    handle: (ctx, { params, body }) => {
      const note = (body as { note?: unknown } | null)?.note;
      acknowledge(ctx, params.id, typeof note === 'string' ? note : '');
      return null;
    },
  },
  {
    method: 'PATCH',
    path: '/alert-rules/:id',
    handle: (ctx, { params, body }) => {
      const enabled = (body as { enabled?: unknown } | null)?.enabled;
      if (typeof enabled !== 'boolean') throw new HttpError(400, 'body must be { "enabled": true | false }');
      if (!setRuleEnabled(ctx, params.id, enabled)) throw new HttpError(404, `Rule ${params.id} not found`);
      return null;
    },
  },
  {
    method: 'GET',
    path: '/services/:id',
    handle: (ctx, { params }) => serviceDetail(ctx, params.id) ?? (() => { throw new HttpError(404, `Service ${params.id} not found`); })(),
  },
  { method: 'GET', path: '/projects/nexusinfra', handle: (ctx) => nexusInfra(ctx) },
  { method: 'GET', path: '/projects/finvault', handle: (ctx) => finVault(ctx) },
  { method: 'GET', path: '/settings', handle: (ctx) => settings(ctx) },
  {
    method: 'PATCH',
    path: '/settings',
    handle: (ctx, { body }) => {
      if (!body || typeof body !== 'object') throw new HttpError(400, 'body must be a JSON object');
      try {
        updateSettings(ctx, body as SettingsPatch);
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      return null;
    },
  },
  {
    method: 'POST',
    path: '/settings/channels/:id/test',
    handle: async (ctx, { params }) => (await testChannel(ctx, params.id)) ?? (() => { throw new HttpError(404, `Channel ${params.id} not found`); })(),
  },
  // Not fed by a live source yet: answered from the dashboard's sample generators.
  ...sampledRoutes,
];
