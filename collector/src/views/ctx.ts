/**
 * What every view gets. `live` says, per part of the API, whether a source is configured for it;
 * a part that is not live is answered from the dashboard's sample data.
 */
import type { Config, HealthTarget } from '../config.js';
import type { Mailer, NotifyDeps } from '../notify/channels.js';
import { sample } from '../sample.js';
import type { Store } from '../store.js';
import type { Clock, Fetch, TaskStatus } from '../sources/types.js';
import { restoreState } from './persist.js';

export interface Live {
  /** Health targets → services, monitors, service detail. */
  services: boolean;
  /** Control Room or bus → nodes. */
  nodes: boolean;
  /** Bus → CPU / memory / disk per node (only node heartbeats carry resources). */
  nodeMetrics: boolean;
  /** Prometheus → requests, 5xx, p95. */
  requests: boolean;
  /** Prometheus or Control Room → queue depths (dead letters, outbox). */
  queues: boolean;
  /** Docker socket → containers, top consumers, network. */
  docker: boolean;
  /** Bus → top-ups, payments, transfers, billing (views/business.ts). */
  business: boolean;
  /**
   * Any source at all. Then the whole API is "real": a part without a source answers empty or
   * unknown, never sample data. Logs, alerts and incidents come from the store.
   */
  logs: boolean;
}

export interface Ctx {
  store: Store;
  config: Config;
  clock: Clock;
  sample: typeof sample;
  live: Live;
  tasks: () => TaskStatus[];
  startedAt: number;
  /** What the notification senders use to reach the outside world. */
  notify: NotifyDeps;
  /** Set by index.ts once the scheduler runs: starts / stops checking a monitor added or removed at runtime. */
  monitors?: { scheduled: (t: HealthTarget) => void; unscheduled: (id: string) => void };
}

export function liveFor(config: Config): Live {
  const services = config.health.targets.length > 0;
  const nodes = Boolean(config.controlRoom || config.bus);
  const requests = config.metrics.targets.length > 0;
  return {
    services,
    nodes,
    nodeMetrics: Boolean(config.bus),
    requests,
    queues: requests || Boolean(config.controlRoom),
    business: Boolean(config.bus),
    docker: Boolean(config.docker),
    logs: services || nodes || requests || Boolean(config.bus) || Boolean(config.docker),
  };
}

export function createCtx(store: Store, config: Config, opts: { clock?: Clock; tasks?: () => TaskStatus[]; fetch?: Fetch; mail?: Mailer | null; mailer?: (smtpUrl: string) => Mailer } = {}): Ctx {
  const clock = opts.clock ?? Date.now;
  // Alerting and incident writes from an earlier run (views/persist.ts).
  restoreState(store, Object.values(liveFor(config)).some(Boolean));
  return {
    store, config, clock, sample, live: liveFor(config), tasks: opts.tasks ?? (() => []), startedAt: clock(),
    notify: { fetch: opts.fetch ?? fetch, mail: opts.mail ?? null, ...(opts.mailer ? { mailer: opts.mailer } : {}), timeoutMs: config.notify.timeoutMs },
  };
}

export const iso = (ms: number) => new Date(ms).toISOString();
export const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000));
export const DAY_MS = 86_400_000;
