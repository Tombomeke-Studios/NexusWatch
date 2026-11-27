/** Entry point: config → store → sources → HTTP. Everything here is wiring; logic lives in tested modules. */
import './env.js';
import { rulesTask } from './alerting/evaluate.js';
import { loadConfig } from './config.js';
import { notifyTask } from './notify/dispatch.js';
import { createMailer } from './notify/mailer.js';
import { HeartbeatConsumer, startBus } from './sources/bus.js';
import { BusinessRecorder } from './sources/business.js';
import { controlRoomTask } from './sources/controlRoom.js';
import { healthTasks } from './sources/health.js';
import { DEGRADED_MS, evaluateBusSources } from './sources/heartbeat.js';
import { PrometheusScraper, metricsTasks } from './sources/prometheus.js';
import { Scheduler } from './sources/scheduler.js';
import type { Task } from './sources/types.js';
import { createApp } from './server.js';
import { DockerSource, socketApi } from './sources/docker.js';
import { Store } from './store.js';
import { storedMonitors } from './monitors.js';
import { createCtx } from './views/ctx.js';
import { prune } from './views/settings.js';

const config = loadConfig();
const store = new Store(config.dbPath);
const clock = Date.now;
// Monitors added from the dashboard join NW_HEALTH_TARGETS (an id in both: the variable's wins).
for (const t of storedMonitors(store, config.health.timeoutMs)) {
  if (!config.health.targets.some((x) => x.id === t.id)) config.health.targets.push(t);
}

function dockerTask(docker: NonNullable<typeof config.docker>): Task {
  const source = new DockerSource(store, socketApi(docker.socket), clock);
  return { name: 'docker', intervalMs: docker.intervalMs, run: async () => void (await source.poll()) };
}

const tasks: Task[] = [
  ...healthTasks(config.health.targets, store, fetch, clock, { slowMs: config.health.slowMs, failuresForIncident: config.health.failuresForIncident }),
  ...(config.controlRoom ? [controlRoomTask(config.controlRoom, store, fetch, clock)] : []),
  ...metricsTasks(config.metrics.targets, new PrometheusScraper(store, fetch, clock, config.metrics.token), config.metrics.intervalMs),
  ...(config.docker ? [dockerTask(config.docker)] : []),
  ...(config.bus ? [{ name: 'bus:evaluate', intervalMs: DEGRADED_MS, run: async () => evaluateBusSources(store, clock()) }] : []),
];
const email = config.notify.targets.email;
const ctx = createCtx(store, config, {
  clock,
  tasks: () => scheduler.snapshot(),
  mail: email ? createMailer(email.smtpUrl, config.notify.timeoutMs) : null,
  // For an SMTP server set up in Settings instead of NW_SMTP_URL.
  mailer: (smtpUrl) => createMailer(smtpUrl, config.notify.timeoutMs),
});
// Rules and notifications only make sense for real measurements, so both exist only with a live source.
let alerting = ctx.live.logs;
if (alerting) tasks.push(rulesTask(ctx), notifyTask(ctx));
const scheduler: Scheduler = new Scheduler(tasks, clock, (task, error) => console.warn(`[collector] ${task}: ${error}`));
const healthOptions = { slowMs: config.health.slowMs, failuresForIncident: config.health.failuresForIncident };
ctx.monitors = {
  scheduled: (t) => {
    for (const task of healthTasks([t], store, fetch, clock, healthOptions)) scheduler.add(task);
    // The first monitor of a collector that started without sources turns alerting on.
    if (!alerting) {
      alerting = true;
      scheduler.add(rulesTask(ctx));
      scheduler.add(notifyTask(ctx));
    }
  },
  unscheduled: (id) => scheduler.remove(`health:${id}`),
};

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
  const consumer = new HeartbeatConsumer(store, clock, process.env.FINVAULT_MESSAGE_KEY, new BusinessRecorder(store));
  void startBus(url, queue, consumer, (error) => {
    scheduler.report('bus', 0, error);
    if (error) console.warn(`[collector] event bus: ${error}`);
  }).then((stop) => (stopBus = stop));
}

const live = Object.entries(ctx.live).filter(([, on]) => on).map(([k]) => k);
const server = createApp(ctx).listen(config.port, () => {
  console.log(`[collector] listening on http://localhost:${config.port} (API under /api)`);
  console.log(`[collector] live: ${live.length ? live.join(', ') : 'nothing — every endpoint serves sample data'}`);
  const channels = Object.entries(config.notify.targets).filter(([, t]) => t).map(([id]) => id);
  console.log(`[collector] notification channels: ${channels.length ? channels.join(', ') : 'none configured'}`);
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
