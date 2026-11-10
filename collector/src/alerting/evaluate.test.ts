import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { notifyOnce } from '../notify/dispatch.js';
import { sample } from '../sample.js';
import type { Fetch } from '../sources/types.js';
import { Store } from '../store.js';
import { alerts, setRuleEnabled } from '../views/alerts.js';
import { createCtx } from '../views/ctx.js';
import { evaluateRules, formatValue, parseSubject, subjectOf, testRuleLive } from './evaluate.js';
import { bucketsBack, liveReadings } from './readings.js';

const STEP = 30_000;
const ENV = {
  NW_HEALTH_TARGETS: JSON.stringify([{ id: 'nx-api', name: 'api-gateway', project: 'nexusinfra', url: 'http://nx:8000/health' }]),
  NW_RABBITMQ_URL: 'amqp://fake',
  NW_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/secret',
};

// The stored rule set (sample module): r4 = latency_ms > 100 for 5m (warning), r5 = cpu > 85% for 10m (warning),
// r3 = disk > 90% for 15m (critical), all NexusInfra.
function setup() {
  let now = Date.now();
  const store = new Store();
  const sent: string[] = [];
  const fetch: Fetch = async (_url, init) => {
    sent.push((JSON.parse(init?.body as string) as { embeds: { title: string }[] }).embeds[0].title);
    return new Response('{}');
  };
  const ctx = createCtx(store, loadConfig(ENV), { clock: () => now, fetch });
  /** One health check per step, newest last; null = the check failed. */
  const check = (...latencies: (number | null)[]) => {
    for (const latencyMs of latencies) {
      now += STEP;
      store.addCheck('nx-api', { ts: now, status: latencyMs === null ? 'down' : latencyMs > 100 ? 'slow' : 'up', latencyMs, note: '' });
    }
  };
  /** One node sample per minute, newest last. */
  const node = (metric: string, ...values: (number | null)[]) => {
    for (const v of values) {
      now += 60_000;
      if (v !== null) store.addSample(metric, 'node-pi', now - 1000, v);
    }
  };
  const open = () => store.incidents(now).filter((i) => i.endedAt === null);
  return { ctx, store, sent, check, node, open, run: () => evaluateRules(ctx) };
}

const fresh = sample.alertingState();
afterEach(() => sample.restoreAlertingState(fresh));

describe('bucketsBack', () => {
  it('averages per step counted back from now and leaves empty steps unknown', () => {
    const at = (ts: number, value: number) => ({ series: 'n', ts, value });
    expect(bucketsBack([at(940, 10), at(960, 30), at(700, 5), at(100, 1)], 1000, 100, 4)).toEqual([5, null, null, 20]);
  });
});

describe('evaluateRules', () => {
  it('fires only once the condition has held for the rule duration', () => {
    const t = setup();
    t.check(40, ...Array<number>(9).fill(140));
    t.run();
    expect(t.open()).toHaveLength(0);

    t.check(140);
    t.run();
    t.run();
    const [incident] = t.open();
    expect(incident).toMatchObject({ subject: 'rule:r4:nx-api', severity: 'warning', project: 'nexusinfra', title: 'Slow heartbeat: api-gateway' });
    expect(incident.note).toBe('latency_ms > 100 for 5m — 140 ms when it fired.');
    expect(t.open()).toHaveLength(1);

    const alert = alerts(t.ctx).active[0];
    expect(alert).toMatchObject({ ruleId: 'r4', serviceId: 'nx-api', rule: 'latency_ms > 100 for 5m', value: '140 ms' });
    expect(alert.trend.at(-1)).toBe(140);
  });

  it('resolves when the condition clears, and logs both ends', () => {
    const t = setup();
    t.check(...Array<number>(10).fill(140));
    t.run();
    t.check(60);
    t.run();
    expect(t.open()).toHaveLength(0);
    const messages = t.store.logs({ from: 0, to: Number.MAX_SAFE_INTEGER }).map((l) => l.message);
    expect(messages).toContain('Alert fired — Slow heartbeat: api-gateway (140 ms)');
    expect(messages).toContain('Alert resolved — Slow heartbeat: api-gateway (60 ms)');
  });

  it('never counts a missing answer as a value: it neither fires nor resolves', () => {
    const t = setup();
    // Five slow answers, a failed check, five more: the condition has not held for 5 minutes in a row.
    t.check(...Array<number>(5).fill(140), null, ...Array<number>(5).fill(140));
    t.run();
    expect(t.open()).toHaveLength(0);

    t.check(...Array<number>(5).fill(140));
    t.run();
    expect(t.open()).toHaveLength(1);
    // The service stops answering: no latency to judge, so the alert stays open.
    t.check(null, null);
    t.run();
    expect(t.open().map((i) => i.subject)).toEqual(['rule:r4:nx-api']);
  });

  it('evaluates node metrics per node, with a silent minute as unknown', () => {
    const t = setup();
    t.node('cpu', ...Array<number>(9).fill(95));
    t.run();
    expect(t.open()).toHaveLength(0);
    t.node('cpu', 95);
    t.run();
    expect(t.open()[0]).toMatchObject({ subject: 'rule:r5:node-pi', title: 'High CPU: node-pi' });
    expect(alerts(t.ctx).active[0]).toMatchObject({ ruleId: 'r5', value: '95%', rule: 'cpu > 85% for 10m' });

    const gap = setup();
    gap.node('cpu', ...Array<number>(6).fill(95), null, ...Array<number>(6).fill(95));
    gap.run();
    expect(gap.open()).toHaveLength(0);
  });

  it('closes an alert whose rule is switched off or deleted', () => {
    const t = setup();
    t.check(...Array<number>(10).fill(140));
    t.run();
    setRuleEnabled(t.ctx, 'r4', false);
    t.run();
    expect(t.open()).toHaveLength(0);

    setRuleEnabled(t.ctx, 'r4', true);
    t.run();
    expect(t.open()).toHaveLength(1);
    sample.deleteRule('r4');
    t.run();
    expect(t.open()).toHaveLength(0);
  });

  it('leaves outages to the health checker instead of raising them twice', () => {
    const t = setup();
    t.check(...Array<null>(12).fill(null));
    t.run();
    expect(t.open()).toHaveLength(0);
  });

  it('does nothing on sample data', () => {
    const store = new Store();
    const ctx = createCtx(store, loadConfig({}));
    evaluateRules(ctx);
    expect(store.hasIncidentHistory()).toBe(false);
  });
});

describe('silences and maintenance windows on live alerts', () => {
  it('marks a rule alert inside a maintenance window and holds its notification until the window is gone', async () => {
    const t = setup();
    const window = sample.createMaintenance({ title: 'Gateway upgrade', project: 'nexusinfra', serviceId: 'nx-api', startsAt: new Date(Date.now() - 60_000).toISOString(), durationMinutes: 600, recurrence: 'none' }, t.ctx.config.health.targets);
    t.check(...Array<number>(10).fill(140));
    t.run();
    const a = alerts(t.ctx);
    expect(a.active[0].maintenanceId).toBe(window.id);
    expect(a.summary.inMaintenance).toBe(1);
    expect(a.maintenance.map((w) => w.id)).toContain(window.id);
    expect(a.services).toEqual([{ id: 'nx-api', name: 'api-gateway', project: 'nexusinfra' }]);

    await notifyOnce(t.ctx);
    expect(t.sent).toEqual([]);
    sample.deleteMaintenance(window.id);
    await notifyOnce(t.ctx);
    expect(t.sent).toEqual(['[WARNING] Slow heartbeat: api-gateway']);
  });

  it('marks and holds an alert whose rule is muted', async () => {
    const t = setup();
    const silence = sample.createSilence({ kind: 'rule', targetId: 'r4', duration: '1h', reason: 'Known slow deploy' });
    t.check(...Array<number>(10).fill(140));
    t.run();
    const a = alerts(t.ctx);
    expect(a.active[0].silenceId).toBe(silence.id);
    expect(a.summary.muted).toBe(a.silences.length);
    await notifyOnce(t.ctx);
    expect(t.sent).toEqual([]);
  });
});

describe('testRuleLive', () => {
  it('reports each target with its state, and no targets for a metric without a source', () => {
    const t = setup();
    t.check(...Array<number>(4).fill(140));
    const pending = testRuleLive(t.ctx, { project: 'nexusinfra', condition: { metric: 'latency', comparator: '>', threshold: 100, forSeconds: 300 } });
    expect(pending.fires).toBe(false);
    expect(pending.targets).toEqual([{ target: 'api-gateway', serviceId: 'nx-api', state: 'pending', value: 140, heldSeconds: 120 }]);
    expect(testRuleLive(t.ctx, { project: 'nexusinfra', condition: { metric: 'latency', comparator: '>', threshold: 100, forSeconds: 60 } }).fires).toBe(true);
    expect(testRuleLive(t.ctx, { project: 'finvault', condition: { metric: 'queue_depth', comparator: '>', threshold: 25, forSeconds: 0 } }).targets).toEqual([]);
  });
});

describe('helpers', () => {
  it('round-trips a subject, also when the target contains a colon', () => {
    expect(parseSubject(subjectOf('r5', 'node:pi'))).toEqual({ ruleId: 'r5', key: 'node:pi' });
    expect(parseSubject('service:nx-api')).toBeNull();
  });

  it('formats a value with its unit, and unknown as no data', () => {
    expect(formatValue('latency', 139.96)).toBe('140 ms');
    expect(formatValue('cpu', 92.44)).toBe('92.4%');
    expect(formatValue('cpu', null)).toBe('no data');
  });

  it('reads heartbeat and latency per health target at its own interval', () => {
    const t = setup();
    t.check(40, null);
    const r = liveReadings(t.ctx, 0);
    expect(r.find((x) => x.metric === 'heartbeat')?.reading).toMatchObject({ target: 'api-gateway', serviceId: 'nx-api', stepSeconds: 30, samples: [1, 0] });
    expect(r.find((x) => x.metric === 'latency')?.reading.samples).toEqual([40, null]);
  });
});
