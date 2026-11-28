/**
 * The heartbeat checker: `GET` every configured `/health` URL on its interval and store the result.
 *
 * - 2xx within the timeout → `up`, or `slow` above the slow threshold (or when the body says
 *   `status: "degraded"`). Latency is measured.
 * - Anything else (timeout, refused, non-2xx) → `down` with **null** latency, never 0.
 *
 * Side effects, all in the store: every failed check writes an error log line; a status change
 * writes a warn/ok line; the Nth failure in a row opens an incident and the next good check
 * closes it.
 */
import { isPaused } from '../monitors.js';
import type { HealthTarget } from '../config.js';
import type { HealthStatus } from '../contract.js';
import type { Check, Store } from '../store.js';
import { errorText, type Clock, type Fetch, type Task } from './types.js';

export interface HealthOptions {
  slowMs: number;
  failuresForIncident: number;
  /** Shown as the log line's node. */
  node?: string;
}

export async function checkOnce(target: HealthTarget, fetchFn: Fetch, clock: Clock, slowMs: number): Promise<Check> {
  const started = clock();
  try {
    const res = await fetchFn(target.url, { signal: AbortSignal.timeout(target.timeoutMs), headers: { Accept: 'application/json' } });
    const latencyMs = Math.max(0, Math.round(clock() - started));
    const body = await res.text().catch(() => '');
    if (!res.ok) return { ts: started, status: 'down', latencyMs: null, note: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}` };
    if (latencyMs > target.timeoutMs) return { ts: started, status: 'down', latencyMs: null, note: `timed out after ${target.timeoutMs / 1000} s` };
    let degraded = false;
    try {
      degraded = (JSON.parse(body) as { status?: unknown }).status === 'degraded';
    } catch {
      // A non-JSON 2xx body is fine: the answer itself is the heartbeat.
    }
    const status: HealthStatus = degraded || latencyMs > slowMs ? 'slow' : 'up';
    return { ts: started, status, latencyMs, note: `${res.status} ${res.statusText || 'OK'}${degraded ? ' (degraded)' : ''}`.trim() };
  } catch (err) {
    const text = errorText(err);
    return { ts: started, status: 'down', latencyMs: null, note: text === 'timed out' ? `timed out after ${target.timeoutMs / 1000} s` : text };
  }
}

/** Number of `down` checks at the end of the list. */
export function trailingFailures(checks: Check[]): number {
  let n = 0;
  for (let i = checks.length - 1; i >= 0 && checks[i].status === 'down'; i--) n++;
  return n;
}

const subjectOf = (target: HealthTarget) => `service:${target.id}`;

/** Checks one target, stores the check and writes logs/incidents for what changed. */
export async function runHealthCheck(target: HealthTarget, store: Store, fetchFn: Fetch, clock: Clock, opts: HealthOptions): Promise<Check> {
  const previous = store.lastChecks(target.id, 1)[0];
  const check = await checkOnce(target, fetchFn, clock, opts.slowMs);
  store.addCheck(target.id, check);

  const node = opts.node ?? 'collector';
  const log = (level: 'error' | 'warn' | 'ok' | 'info', message: string, fields: Record<string, string | number | boolean> = {}) =>
    store.addLog({ ts: check.ts, level, service: target.name, serviceId: target.id, project: target.project, node, message, fields: { target: target.url, port: target.port, ...fields } });

  if (check.status === 'down') {
    const failures = trailingFailures(store.lastChecks(target.id, opts.failuresForIncident + 1));
    log('error', `healthcheck failed: ${check.note}`, { consecutiveFailures: failures });
    if (failures === opts.failuresForIncident && !store.openIncidentFor(subjectOf(target))) {
      store.openIncident({
        subject: subjectOf(target),
        project: target.project,
        severity: 'critical',
        title: `${target.name} is not responding`,
        note: `Health check on ${target.port} fails: ${check.note}.`,
        startedAt: store.lastChecks(target.id, failures)[0].ts,
      });
    }
    return check;
  }

  if (!previous) log('info', `monitoring started: healthcheck passed in ${check.latencyMs} ms`, { latencyMs: check.latencyMs ?? 0 });
  else if (check.status === 'slow' && previous.status !== 'slow')
    log('warn', `response time above threshold: ${check.latencyMs} ms (${opts.slowMs} ms)`, { latencyMs: check.latencyMs ?? 0, thresholdMs: opts.slowMs });
  else if (check.status === 'up' && previous.status !== 'up') log('ok', `healthcheck passed in ${check.latencyMs} ms`, { latencyMs: check.latencyMs ?? 0 });

  if (store.closeIncidents(subjectOf(target), check.ts) > 0) log('ok', `${target.name} is responding again`);
  return check;
}

export function healthTasks(targets: HealthTarget[], store: Store, fetchFn: Fetch, clock: Clock, opts: HealthOptions): Task[] {
  return targets.map((t) => ({
    name: `health:${t.id}`,
    intervalMs: t.intervalMs,
    run: async () => {
      if (isPaused(store, t.id)) return;
      await runHealthCheck(t, store, fetchFn, clock, opts);
    },
  }));
}
