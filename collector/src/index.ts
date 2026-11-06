/** Entry point: config → store → sources → HTTP. Everything here is wiring; logic lives in tested modules. */
import { loadConfig } from './config.js';
import { HeartbeatConsumer, startBus } from './sources/bus.js';
import { controlRoomTask } from './sources/controlRoom.js';
import { healthTasks } from './sources/health.js';
import { DEGRADED_MS, evaluateBusSources } from './sources/heartbeat.js';
import { PrometheusScraper, metricsTasks } from './sources/prometheus.js';
import { Scheduler } from './sources/scheduler.js';
import type { Task } from './sources/types.js';
import { createApp } from './server.js';
import { Store } from './store.js';
import { createCtx } from './views/ctx.js';
import { prune } from './views/settings.js';

const config = loadConfig();
const store = new Store(config.dbPath);
const clock = Date.now;

const tasks: Task[] = [
  ...healthTasks(config.health.targets, store, fetch, clock, { slowMs: config.health.slowMs, failuresForIncident: config.health.failuresForIncident }),
  ...(config.controlRoom ? [controlRoomTask(config.controlRoom, store, fetch, clock)] : []),
  ...metricsTasks(config.metrics.targets, new PrometheusScraper(store, fetch, clock, config.metrics.token), config.metrics.intervalMs),
  ...(config.bus ? [{ name: 'bus:evaluate', intervalMs: DEGRADED_MS, run: async () => evaluateBusSources(store, clock()) }] : []),
];
const scheduler = new Scheduler(tasks, clock, (task, error) => console.warn(`[collector] ${task}: ${error}`));
const ctx = createCtx(store, config, { clock, tasks: () => scheduler.snapshot() });

// Retention: once at start, then on an interval (and whenever Settings changes it).
const pruneOnce = () => {
  try {
    const removed = prune(ctx);
    const total = removed.logs + removed.metrics + removed.heartbeats;
    if (total) console.log(`[collector] retention removed ${removed.logs} log lines, ${removed.metrics} samples, ${removed.heartbeats} heartbeat rows`);
  } catch (err) {
    console.error('[collector] retention failed:', err);
  }
};
pruneOnce();
const pruneTimer = setInterval(pruneOnce, config.pruneIntervalMs);

scheduler.start();
let stopBus: (() => Promise<void>) | null = null;
if (config.bus) {
  const { url, queue } = config.bus;
  const consumer = new HeartbeatConsumer(store, clock);
  void startBus(url, queue, consumer, (error) => {
    scheduler.report('bus', 0, error);
    if (error) console.warn(`[collector] event bus: ${error}`);
  }).then((stop) => (stopBus = stop));
}

const live = Object.entries(ctx.live).filter(([, on]) => on).map(([k]) => k);
const server = createApp(ctx).listen(config.port, () => {
  console.log(`[collector] listening on http://localhost:${config.port} (API under /api)`);
  console.log(`[collector] live: ${live.length ? live.join(', ') : 'nothing — every endpoint serves sample data'}`);
});

const shutdown = async () => {
  scheduler.stop();
  clearInterval(pruneTimer);
  await stopBus?.();
  server.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
