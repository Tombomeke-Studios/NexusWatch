import { describe, expect, it } from 'vitest';
import { Store } from '../store.js';
import { PrometheusScraper, parsePrometheus, quantileFromBuckets } from './prometheus.js';

/** Shaped exactly like NexusInfra's MetricsRegistry output (shared/src/metrics.ts). */
function exposition(requests: number, errors: number, fast: number, slow: number): string {
  return [
    '# HELP nexusinfra_http_requests_total HTTP requests handled, by route pattern and status class.',
    '# TYPE nexusinfra_http_requests_total counter',
    `nexusinfra_http_requests_total{service="orchestrator",method="GET",route="/deployments/:id",status="2xx"} ${requests - errors}`,
    `nexusinfra_http_requests_total{service="orchestrator",method="POST",route="/deployments",status="5xx"} ${errors}`,
    '# TYPE nexusinfra_http_request_duration_seconds histogram',
    `nexusinfra_http_request_duration_seconds_bucket{service="orchestrator",method="GET",route="/deployments/:id",le="0.05"} ${fast}`,
    `nexusinfra_http_request_duration_seconds_bucket{service="orchestrator",method="GET",route="/deployments/:id",le="0.1"} ${fast + slow}`,
    `nexusinfra_http_request_duration_seconds_bucket{service="orchestrator",method="GET",route="/deployments/:id",le="+Inf"} ${fast + slow}`,
    `nexusinfra_http_request_duration_seconds_sum{service="orchestrator",method="GET",route="/deployments/:id"} 1.5`,
    '# TYPE nexusinfra_dead_letters gauge',
    'nexusinfra_dead_letters 4',
    'nexusinfra_agent_containers{state="running"} 7',
    'nexusinfra_agent_containers{state="stopped"} 1',
    'nexusinfra_build_info{service="orchestrator",version="1.2.0",edition="community"} 1',
    'process_resident_memory_bytes 81234944',
    '',
  ].join('\n');
}

describe('parsePrometheus', () => {
  it('keeps only the series the dashboard uses', () => {
    const names = new Set(parsePrometheus(exposition(10, 1, 5, 5)).map((s) => s.name));
    expect(names.has('nexusinfra_http_requests_total')).toBe(true);
    expect(names.has('nexusinfra_build_info')).toBe(false);
    expect(names.has('process_resident_memory_bytes')).toBe(false);
  });

  it('reads labels with escapes, special values and timestamps', () => {
    const [s] = parsePrometheus('m{a="x\\"y",le="+Inf"} +Inf 1700000000000', null);
    expect(s).toEqual({ name: 'm', labels: { a: 'x"y', le: '+Inf' }, value: Infinity });
    expect(parsePrometheus('garbage line\nok 1', null)).toEqual([{ name: 'ok', labels: {}, value: 1 }]);
  });
});

describe('quantileFromBuckets', () => {
  it('interpolates inside the bucket like histogram_quantile', () => {
    const prev = new Map([[0.05, 0], [0.1, 0], [Infinity, 0]]);
    const curr = new Map([[0.05, 50], [0.1, 100], [Infinity, 100]]);
    expect(quantileFromBuckets(prev, curr, 0.95)).toBeCloseTo(0.095);
    expect(quantileFromBuckets(curr, curr, 0.95)).toBeNull();
  });
});

describe('PrometheusScraper', () => {
  it('stores gauges at once and rates from the second scrape on', () => {
    const store = new Store();
    const t0 = Date.UTC(2026, 10, 5, 10);
    const scraper = new PrometheusScraper(store, async () => new Response(''), () => t0);
    scraper.ingest('orchestrator', parsePrometheus(exposition(100, 2, 50, 50)), t0);
    expect(store.hasSamples('requests')).toBe(false);
    expect(store.latestSamples('queues')).toEqual([{ series: 'dead-letters', ts: t0, value: 4 }]);
    expect(store.latestSamples('containers')[0].value).toBe(7);

    scraper.ingest('orchestrator', parsePrometheus(exposition(130, 5, 60, 70)), t0 + 10_000);
    expect(store.latestSamples('requests')[0].value).toBeCloseTo(3); // 30 requests / 10 s
    expect(store.latestSamples('errors5xx')[0].value).toBeCloseTo(0.3);
    expect(store.latestSamples('latency_p95')[0].value).toBeGreaterThan(50);
  });

  it('treats a counter that went down as a restart, not a negative rate', () => {
    const store = new Store();
    const scraper = new PrometheusScraper(store, async () => new Response(''), () => 0);
    scraper.ingest('gw', parsePrometheus(exposition(1000, 0, 500, 500)), 1000);
    scraper.ingest('gw', parsePrometheus(exposition(20, 0, 10, 10)), 11_000);
    expect(store.latestSamples('requests')[0].value).toBeCloseTo(2);
  });

  it('sends the bearer token and fails on a non-2xx scrape', async () => {
    const store = new Store();
    let auth = '';
    const scraper = new PrometheusScraper(
      store,
      async (_url, init) => {
        auth = new Headers(init?.headers).get('authorization') ?? '';
        return new Response('', { status: 401 });
      },
      () => 0,
      'secret',
    );
    await expect(scraper.scrape({ name: 'cr', url: 'http://cr:9000/metrics' })).rejects.toThrow(/401/);
    expect(auth).toBe('Bearer secret');
  });
});
