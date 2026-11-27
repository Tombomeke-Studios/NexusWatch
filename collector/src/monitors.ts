/**
 * Monitors added from the dashboard, next to NW_HEALTH_TARGETS. They live in SQLite and join the one
 * target list (`config.health.targets`) everything else reads, so a new monitor shows up on every page.
 * Validation is the dashboard's own `validateMonitor` (same host rules as notification targets).
 * Paused monitors stay listed but are not checked.
 */
import { monitorId, validateMonitor } from '@/lib/monitors';
import type { HealthTarget } from './config.js';
import type { Monitor, MonitorSource } from './contract.js';
import { HttpError } from './routes.js';
import type { Store } from './store.js';
import type { Ctx } from './views/ctx.js';

const STORED = 'monitors';
const PAUSED = 'monitors.paused';

/** The monitors added from the dashboard, as health targets. */
export function storedMonitors(store: Store, timeoutMs: number): HealthTarget[] {
  return (store.get<HealthTarget[]>(STORED) ?? []).map((t) => ({ ...t, timeoutMs, source: 'dashboard' }));
}

export function isPaused(store: Store, id: string): boolean {
  return (store.get<string[]>(PAUSED) ?? []).includes(id);
}

export const sourceOf = (t: HealthTarget): MonitorSource => t.source ?? 'env';

function save(ctx: Ctx): void {
  ctx.store.set(STORED, ctx.config.health.targets.filter((t) => t.source === 'dashboard').map(({ id, name, project, url, port, intervalMs }) => ({ id, name, project, url, port, intervalMs })));
}

/** `POST /monitors`. 422 when a field does not validate. */
export function addMonitor(ctx: Ctx, body: unknown): HealthTarget {
  const result = validateMonitor((body ?? {}) as Record<string, unknown>);
  if (!result.ok) throw new HttpError(422, `${result.field}: ${result.error}`);
  const { name, project, url, intervalSeconds } = result.value;
  const parsed = new URL(url);
  const target: HealthTarget = {
    id: monitorId(name, ctx.config.health.targets.map((t) => t.id)),
    name,
    project,
    url,
    port: `:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`,
    intervalMs: intervalSeconds * 1000,
    timeoutMs: ctx.config.health.timeoutMs,
    source: 'dashboard',
  };
  ctx.config.health.targets.push(target);
  // The first monitor makes the API live, like a configured source does.
  ctx.live.services = true;
  ctx.live.logs = true;
  save(ctx);
  ctx.monitors?.scheduled(target);
  return target;
}

function find(ctx: Ctx, id: string): HealthTarget {
  const t = ctx.config.health.targets.find((x) => x.id === id);
  if (!t) throw new HttpError(404, `Monitor ${id} not found`);
  return t;
}

/** `DELETE /monitors/:id`. 409 for a monitor from NW_HEALTH_TARGETS. Its history stays until retention prunes it. */
export function removeMonitor(ctx: Ctx, id: string): void {
  const t = find(ctx, id);
  if (t.source !== 'dashboard') throw new HttpError(409, `${t.name} comes from NW_HEALTH_TARGETS; remove it there`);
  ctx.config.health.targets.splice(ctx.config.health.targets.indexOf(t), 1);
  save(ctx);
  setPaused(ctx, id, false);
  ctx.monitors?.unscheduled(id);
}

/** `PUT /monitors/:id/paused`: works for every monitor, also those from NW_HEALTH_TARGETS. */
export function setPaused(ctx: Ctx, id: string, paused: boolean): void {
  const list = (ctx.store.get<string[]>(PAUSED) ?? []).filter((x) => x !== id);
  ctx.store.set(PAUSED, paused ? [...list, id] : list);
}

export function pauseMonitor(ctx: Ctx, id: string, body: unknown): void {
  find(ctx, id);
  const paused = (body as { paused?: unknown } | null)?.paused;
  if (typeof paused !== 'boolean') throw new HttpError(400, 'body must be { "paused": true | false }');
  setPaused(ctx, id, paused);
}

/** The fields every monitor view adds. */
export function monitorFlags(ctx: Ctx, t: HealthTarget): Pick<Monitor, 'source' | 'paused'> {
  return { source: sourceOf(t), paused: isPaused(ctx.store, t.id) };
}
