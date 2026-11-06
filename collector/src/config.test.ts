import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('turns every source off by default', () => {
    const c = loadConfig({});
    expect(c.port).toBe(8080);
    expect(c.health.targets).toEqual([]);
    expect(c.controlRoom).toBeNull();
    expect(c.metrics.targets).toEqual([]);
    expect(c.bus).toBeNull();
  });

  it('reads health targets from JSON, deriving the port and applying default timings', () => {
    const c = loadConfig({
      NW_HEALTH_INTERVAL_MS: '10000',
      NW_HEALTH_TARGETS: JSON.stringify([
        { id: 'nx-control-room', name: 'control-room', project: 'nexusinfra', url: 'http://control-room:9000/health' },
        { id: 'fv-gw', name: 'api-gateway', project: 'finvault', url: 'https://fv.example/health', timeoutMs: 2000 },
      ]),
    });
    expect(c.health.targets[0]).toMatchObject({ port: ':9000', intervalMs: 10_000, timeoutMs: 5_000 });
    expect(c.health.targets[1]).toMatchObject({ port: ':443', timeoutMs: 2_000 });
  });

  it('reads health targets from a file', () => {
    const file = JSON.stringify([{ id: 'a', name: 'a', project: 'finvault', url: 'http://a:1/health' }]);
    const c = loadConfig({ NW_HEALTH_TARGETS_FILE: 'targets.json' }, () => file);
    expect(c.health.targets).toHaveLength(1);
  });

  it('rejects broken target lists loudly', () => {
    const t = (list: object[]) => ({ NW_HEALTH_TARGETS: JSON.stringify(list) });
    expect(() => loadConfig({ NW_HEALTH_TARGETS: '{' })).toThrow(/not valid JSON/);
    expect(() => loadConfig(t([{ id: 'a', name: 'a', project: 'other', url: 'http://a/' }]))).toThrow(/project/);
    expect(() =>
      loadConfig(t([{ id: 'a', name: 'a', project: 'finvault', url: 'http://a/' }, { id: 'a', name: 'b', project: 'finvault', url: 'http://b/' }])),
    ).toThrow(/twice/);
    expect(() => loadConfig({ NW_HEALTH_TIMEOUT_MS: 'soon' })).toThrow(/NW_HEALTH_TIMEOUT_MS/);
  });

  it('parses scrape targets, the Control Room and the bus', () => {
    const c = loadConfig({
      NW_METRICS_TARGETS: 'control-room=http://cr:9000/metrics, orchestrator=http://or:9200/metrics',
      NW_CONTROL_ROOM_URL: 'http://cr:9000/',
      NW_RABBITMQ_URL: 'amqp://guest:guest@rabbitmq:5672',
    });
    expect(c.metrics.targets.map((t) => t.name)).toEqual(['control-room', 'orchestrator']);
    expect(c.controlRoom?.url).toBe('http://cr:9000');
    expect(c.controlRoom?.nodePattern.test('node-pi')).toBe(true);
    expect(c.bus?.queue).toBe('nexuswatch.collector');
    expect(() => loadConfig({ NW_METRICS_TARGETS: 'http://x/metrics' })).toThrow(/name=/);
  });
});
