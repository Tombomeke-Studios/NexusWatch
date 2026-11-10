/**
 * Live readings for rule evaluation: per target (a service or a node) the recent samples at a fixed
 * step, oldest first, in the shape `lib/rules.ts` evaluates — so the collector and the dashboard's
 * "test rule" share one set of semantics. A step without a measurement is `null`, never 0.
 *
 * Metrics with a source today: heartbeat and latency (health checks), cpu, memory and disk (node
 * heartbeats on the bus). Queue depth, 5xx rate and top-ups have none yet: they return no readings,
 * so their rules report "no data" and never fire.
 */
import type { Reading } from '../../../dashboard/src/lib/rules.js';
import type { RuleMetric } from '../contract.js';
import type { Sample } from '../store.js';
import type { Ctx } from '../views/ctx.js';

export interface MetricReading {
  metric: RuleMetric;
  reading: Reading;
}

/** Node metrics are bucketed per minute: node heartbeats arrive several times a minute. */
export const NODE_STEP_SECONDS = 60;
/** No reading is longer than this many samples, whatever the rule's "for" says. */
const MAX_SAMPLES = 3000;
const NODE_METRICS = ['cpu', 'memory', 'disk'] as const;

const count = (horizonSeconds: number, stepSeconds: number) => Math.min(MAX_SAMPLES, Math.ceil(horizonSeconds / stepSeconds) + 2);

/**
 * Buckets of `stepMs` counted back from `now`, oldest first: the average of the samples in each, or
 * null. Counting back from now (rather than from the top of the minute) keeps the newest bucket a
 * full step wide, so a source that reports on time never looks silent.
 */
export function bucketsBack(samples: Sample[], now: number, stepMs: number, n: number): (number | null)[] {
  const sums = new Array<number>(n).fill(0);
  const counts = new Array<number>(n).fill(0);
  for (const s of samples) {
    const back = Math.floor((now - s.ts) / stepMs);
    if (s.ts > now || back >= n) continue;
    sums[n - 1 - back] += s.value;
    counts[n - 1 - back]++;
  }
  return sums.map((sum, i) => (counts[i] ? sum / counts[i] : null));
}

/** Readings covering at least `horizonSeconds` back from now, for the metrics that have a source. */
export function liveReadings(ctx: Ctx, horizonSeconds: number): MetricReading[] {
  const out: MetricReading[] = [];
  const now = ctx.clock();

  for (const t of ctx.config.health.targets) {
    const stepSeconds = t.intervalMs / 1000;
    const checks = ctx.store.lastChecks(t.id, count(horizonSeconds, stepSeconds));
    const base = { target: t.name, project: t.project, serviceId: t.id, stepSeconds };
    out.push({ metric: 'heartbeat', reading: { ...base, samples: checks.map((c) => (c.status === 'down' ? 0 : 1)) } });
    out.push({ metric: 'latency', reading: { ...base, samples: checks.map((c) => c.latencyMs) } });
  }

  if (ctx.live.nodeMetrics) {
    const n = count(horizonSeconds, NODE_STEP_SECONDS);
    const stepMs = NODE_STEP_SECONDS * 1000;
    for (const metric of NODE_METRICS) {
      const byNode = new Map<string, Sample[]>();
      for (const s of ctx.store.samples(metric, now - n * stepMs, now)) byNode.set(s.series, [...(byNode.get(s.series) ?? []), s]);
      for (const [node, samples] of [...byNode].sort(([a], [b]) => a.localeCompare(b))) {
        out.push({ metric, reading: { target: node, project: 'nexusinfra', samples: bucketsBack(samples, now, stepMs, n), stepSeconds: NODE_STEP_SECONDS } });
      }
    }
  }
  return out;
}
