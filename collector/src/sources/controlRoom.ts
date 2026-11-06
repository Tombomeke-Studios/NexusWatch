/**
 * NexusInfra Control Room adapter: polls `GET /status` and `GET /uptime`
 * (services/control-room/src/index.ts) and records every heartbeat source it reports.
 *
 * - A source whose name matches `nodePattern` (default `^node-`, NexusInfra's default node id is
 *   `node-<hostname>`) is a node; everything else is a service.
 * - `deadLetters.depth` becomes the `queues` / `dead-letters` sample — only when the Control Room
 *   could ask the broker (`depth: null` means unknown, and unknown is not zero).
 */
import type { Store } from '../store.js';
import { fromControlRoom, recordSource } from './heartbeat.js';
import type { Clock, Fetch, Task } from './types.js';

/** `GET /status` — only the fields NexusWatch reads. */
export interface ControlRoomStatus {
  monitored: { source: string; status: string; lastSeenMsAgo: number; uptimePercent: number }[];
  thresholds?: { degradedMs: number; offlineMs: number };
  deadLetters?: { status: string; depth: number | null; error?: string };
}

/** `GET /uptime` — only the fields NexusWatch reads. */
export interface ControlRoomUptime {
  sources: { source: string; firstSeen: number; observedMs: number; healthyMs: number; transitions: { from: string; to: string; at: number }[] }[];
}

export interface ControlRoomOptions {
  url: string;
  intervalMs: number;
  nodePattern: RegExp;
  timeoutMs?: number;
}

async function getJson<T>(fetchFn: Fetch, url: string, timeoutMs: number): Promise<T> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function pollControlRoom(opts: ControlRoomOptions, store: Store, fetchFn: Fetch, clock: Clock): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const [status, uptime] = await Promise.all([
    getJson<ControlRoomStatus>(fetchFn, `${opts.url}/status`, timeoutMs),
    // /uptime is detail; a Control Room without it still gives a usable /status.
    getJson<ControlRoomUptime>(fetchFn, `${opts.url}/uptime`, timeoutMs).catch(() => ({ sources: [] }) as ControlRoomUptime),
  ]);
  const now = clock();
  const detailOf = new Map(uptime.sources.map((u) => [u.source, u]));

  for (const m of status.monitored ?? []) {
    const u = detailOf.get(m.source);
    recordSource(
      store,
      {
        name: m.source,
        kind: opts.nodePattern.test(m.source) ? 'node' : 'service',
        status: fromControlRoom(m.status),
        lastSeen: now - Math.max(0, m.lastSeenMsAgo),
        uptimePct: Number.isFinite(m.uptimePercent) ? m.uptimePercent : null,
        origin: 'control-room',
        detail: u ? { firstSeen: u.firstSeen, observedMs: u.observedMs, healthyMs: u.healthyMs, transitions: u.transitions.slice(-10) } : {},
      },
      now,
    );
  }

  const depth = status.deadLetters?.depth;
  if (typeof depth === 'number') store.addSample('queues', 'dead-letters', now, depth);
}

export function controlRoomTask(opts: ControlRoomOptions, store: Store, fetchFn: Fetch, clock: Clock): Task {
  return { name: 'control-room', intervalMs: opts.intervalMs, run: () => pollControlRoom(opts, store, fetchFn, clock) };
}
