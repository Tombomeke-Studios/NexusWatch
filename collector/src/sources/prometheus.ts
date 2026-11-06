/**
 * Prometheus text-format (0.0.4) scraper for NexusInfra's `/metrics` (shared/src/metrics.ts).
 * Only the series the dashboard draws are kept; everything else in a scrape is dropped.
 *
 * Stored samples (metric / series):
 * - `requests` / `<target>`        requests per second since the previous scrape
 * - `errors5xx` / `<target>`       5xx answers per second since the previous scrape
 * - `latency_p95` / `<target>`     p95 request duration in ms since the previous scrape
 * - `queues` / `dead-letters`      nexusinfra_dead_letters (only present when the broker answered)
 * - `queues` / `outbox <target>`   nexusinfra_outbox_pending
 * - `containers` / `<target>`      nexusinfra_agent_containers{state="running"}
 * Rates need two scrapes, so the first scrape of a target only stores the gauges.
 */
import type { MetricsTarget } from '../config.js';
import type { Store } from '../store.js';
import type { Clock, Fetch, Task } from './types.js';

export interface PromSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/** The metric families the collector reads. */
export const KEPT = new Set([
  'nexusinfra_http_requests_total',
  'nexusinfra_http_request_duration_seconds_bucket',
  'nexusinfra_dead_letters',
  'nexusinfra_outbox_pending',
  'nexusinfra_agent_containers',
]);

function parseValue(text: string): number {
  if (text === '+Inf') return Infinity;
  if (text === '-Inf') return -Infinity;
  return Number(text);
}

function unescape(v: string): string {
  return v.replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c));
}

/** Parses the text exposition format; `keep` limits which metric names are returned. */
export function parsePrometheus(text: string, keep: Set<string> | null = KEPT): PromSample[] {
  const out: PromSample[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)(\s+\d+)?$/.exec(line);
    if (!m) continue;
    const [, name, , labelText, valueText] = m;
    if (keep && !keep.has(name)) continue;
    const value = parseValue(valueText);
    if (Number.isNaN(value) && valueText !== 'NaN') continue; // not a sample line
    const labels: Record<string, string> = {};
    if (labelText) {
      for (const lm of labelText.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[lm[1]] = unescape(lm[2]);
    }
    out.push({ name, labels, value });
  }
  return out;
}

const sum = (samples: PromSample[], name: string, where: (l: Record<string, string>) => boolean = () => true) =>
  samples.filter((s) => s.name === name && where(s.labels)).reduce((a, s) => a + s.value, 0);

/** Cumulative bucket counts by upper bound, summed over every label set. */
function buckets(samples: PromSample[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const s of samples) {
    if (s.name !== 'nexusinfra_http_request_duration_seconds_bucket') continue;
    const le = parseValue(s.labels.le ?? '');
    if (Number.isNaN(le)) continue;
    out.set(le, (out.get(le) ?? 0) + s.value);
  }
  return out;
}

/**
 * Quantile from the bucket increase between two scrapes (Prometheus' histogram_quantile, linear
 * within the bucket). Null when no request finished in between.
 */
export function quantileFromBuckets(prev: Map<number, number>, curr: Map<number, number>, q: number): number | null {
  const bounds = [...curr.keys()].sort((a, b) => a - b);
  const inc = bounds.map((b) => Math.max(0, (curr.get(b) ?? 0) - (prev.get(b) ?? 0)));
  const total = inc[inc.length - 1] ?? 0;
  if (total <= 0) return null;
  const rank = q * total;
  for (let i = 0; i < bounds.length; i++) {
    if (inc[i] >= rank) {
      const upper = bounds[i];
      const lower = i === 0 ? 0 : bounds[i - 1];
      if (upper === Infinity) return lower;
      const below = i === 0 ? 0 : inc[i - 1];
      const inBucket = inc[i] - below;
      return inBucket > 0 ? lower + (upper - lower) * ((rank - below) / inBucket) : upper;
    }
  }
  return null;
}

/** Counter increase, treating a drop as a restart (the counter started again from 0). */
const increase = (prev: number, curr: number) => (curr >= prev ? curr - prev : curr);

interface Previous {
  ts: number;
  requests: number;
  errors: number;
  buckets: Map<number, number>;
}

export class PrometheusScraper {
  private readonly previous = new Map<string, Previous>();

  constructor(
    private readonly store: Store,
    private readonly fetchFn: Fetch,
    private readonly clock: Clock,
    private readonly token?: string,
    private readonly timeoutMs = 5000,
  ) {}

  async scrape(target: MetricsTarget): Promise<void> {
    const res = await this.fetchFn(target.url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { Accept: 'text/plain', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
    });
    if (!res.ok) throw new Error(`${target.url} answered HTTP ${res.status}`);
    this.ingest(target.name, parsePrometheus(await res.text()), this.clock());
  }

  /** Turns one parsed scrape into stored samples. Public so tests can feed scrapes directly. */
  ingest(target: string, samples: PromSample[], now: number): void {
    const names = new Set(samples.map((s) => s.name));
    if (names.has('nexusinfra_dead_letters')) this.store.addSample('queues', 'dead-letters', now, sum(samples, 'nexusinfra_dead_letters'));
    if (names.has('nexusinfra_outbox_pending')) this.store.addSample('queues', `outbox ${target}`, now, sum(samples, 'nexusinfra_outbox_pending'));
    if (names.has('nexusinfra_agent_containers'))
      this.store.addSample('containers', target, now, sum(samples, 'nexusinfra_agent_containers', (l) => l.state === 'running'));

    if (!names.has('nexusinfra_http_requests_total')) return;
    const current: Previous = {
      ts: now,
      requests: sum(samples, 'nexusinfra_http_requests_total'),
      errors: sum(samples, 'nexusinfra_http_requests_total', (l) => l.status === '5xx'),
      buckets: buckets(samples),
    };
    const prev = this.previous.get(target);
    this.previous.set(target, current);
    if (!prev || now <= prev.ts) return;
    const seconds = (now - prev.ts) / 1000;
    const restarted = current.requests < prev.requests;
    this.store.addSample('requests', target, now, increase(prev.requests, current.requests) / seconds);
    this.store.addSample('errors5xx', target, now, increase(prev.errors, current.errors) / seconds);
    const p95 = quantileFromBuckets(restarted ? new Map() : prev.buckets, current.buckets, 0.95);
    if (p95 !== null) this.store.addSample('latency_p95', target, now, p95 * 1000);
  }
}

export function metricsTasks(targets: MetricsTarget[], scraper: PrometheusScraper, intervalMs: number): Task[] {
  return targets.map((t) => ({ name: `metrics:${t.name}`, intervalMs, run: () => scraper.scrape(t) }));
}
