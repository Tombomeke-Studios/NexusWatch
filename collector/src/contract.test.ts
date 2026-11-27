/**
 * Contract tests: the invariants of dashboard/src/api/mock/data.test.ts, checked against the
 * collector's HTTP responses — once with no source configured (everything from sample data) and
 * once with live sources (health targets, node heartbeats, a Prometheus scrape) fed by fakes.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import type * as C from './contract.js';
import { createApp } from './server.js';
import { BusinessRecorder } from './sources/business.js';
import { HeartbeatConsumer } from './sources/bus.js';
import { runHealthCheck } from './sources/health.js';
import { PrometheusScraper, parsePrometheus } from './sources/prometheus.js';
import type { Fetch } from './sources/types.js';
import { Store } from './store.js';
import { createCtx, type Ctx } from './views/ctx.js';

const TARGETS = [
  { id: 'nx-control-room', name: 'control-room', project: 'nexusinfra', url: 'http://cr:9000/health' },
  { id: 'fv-api-gateway', name: 'api-gateway', project: 'finvault', url: 'http://fv:8000/health' },
  { id: 'fv-invoice-service', name: 'invoice-service', project: 'finvault', url: 'http://fv:8003/health' },
];

interface Api {
  base: string;
  get<T>(path: string): Promise<T>;
  status(path: string, init?: RequestInit): Promise<number>;
  close(): Promise<void>;
}

async function serve(ctx: Ctx): Promise<Api> {
  const server = createApp(ctx).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    async get<T>(path: string) {
      const res = await fetch(base + path);
      if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    },
    async status(path, init) {
      return (await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json' } })).status;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** A collector with live sources, already holding a few minutes of fake history. */
async function liveCtx(): Promise<Ctx> {
  let now = Date.now() - 10 * 60_000;
  const clock = () => now;
  const config = loadConfig({
    NW_HEALTH_TARGETS: JSON.stringify(TARGETS),
    NW_RABBITMQ_URL: 'amqp://fake',
    NW_METRICS_TARGETS: 'orchestrator=http://or:9200/metrics',
  });
  const store = new Store();
  const fetchFor = (id: string): Fetch => async () => {
    if (id === 'fv-invoice-service') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    now += id === 'fv-api-gateway' ? 140 : 30;
    return new Response('{"status":"healthy"}');
  };
  const bus = new HeartbeatConsumer(store, clock, undefined, new BusinessRecorder(store));
  const event = (key: string, type: string, payload: object) =>
    bus.handle(key, Buffer.from(JSON.stringify({ eventId: `${type}-${now}`, timestamp: new Date(now).toISOString(), source: 'test', event: { type, payload } })));
  const scraper = new PrometheusScraper(store, fetchFor('x'), clock);
  for (let i = 0; i < 10; i++) {
    for (const t of config.health.targets) await runHealthCheck(t, store, fetchFor(t.id), clock, { slowMs: 100, failuresForIncident: 3 });
    const beat = { nodeId: 'node-pi', status: 'healthy', resources: { cpuPercent: 30 + i, ramUsedMb: 2048, ramTotalMb: 8192 } };
    bus.handle('monitoring.heartbeat.node.node-pi', Buffer.from(JSON.stringify({ eventId: String(i), timestamp: '', source: 'node-agent:node-pi', event: { type: 'heartbeat.node', payload: beat } })));
    scraper.ingest('orchestrator', parsePrometheus(`nexusinfra_http_requests_total{status="2xx"} ${i * 100}\nnexusinfra_http_requests_total{status="5xx"} ${i}\nnexusinfra_dead_letters 2`), now);
    now += 60_000;
  }
  event('bank.payment.request', 'payment.request', { reference: 'topup-u1-a', senderWalletId: 'u1', amount: 25, customerEmail: 'tom@example.com', description: 'free text' });
  event('events.payment.confirmed', 'payment.confirmed', { reference: 'topup-u1-a', amount: 25 });
  now = Date.now();
  // The node's last heartbeat was a minute ago, so by now it counts as offline.
  return createCtx(store, config, { clock: () => Date.now() });
}

const modes: [string, () => Promise<Ctx>][] = [
  ['sample data (no sources)', async () => createCtx(new Store(), loadConfig({}))],
  ['live sources', liveCtx],
];

describe.each(modes)('HTTP contract — %s', (_mode, make) => {
  let api: Api;
  let live: boolean;
  beforeAll(async () => {
    const ctx = await make();
    live = ctx.live.services;
    api = await serve(ctx);
  });
  afterAll(() => api.close());

  it('counts services consistently in the overview KPIs', async () => {
    const o = await api.get<C.OverviewData>('/api/overview?range=24h');
    expect(o.kpis.servicesTotal).toBe(o.services.length);
    expect(o.kpis.servicesUp + o.kpis.servicesSlow + o.kpis.servicesDown).toBe(o.kpis.servicesTotal);
    expect(o.events.length).toBeGreaterThan(0);
  });

  it('gives every service at most 48 beats and a down service a null latency', async () => {
    const { services } = await api.get<C.OverviewData>('/api/overview?range=24h');
    expect(services.some((s) => s.status === 'down')).toBe(true);
    for (const s of services) {
      if (live) expect(s.beats.length).toBeLessThanOrEqual(48);
      else expect(s.beats).toHaveLength(48);
      if (s.status === 'down') expect(s.latencyMs).toBeNull();
    }
  });

  it('filters logs by level, project and text', async () => {
    const errors = await api.get<C.LogsData>('/api/logs?q=&range=24h&level=error&project=finvault');
    expect(errors.entries.length).toBeGreaterThan(0);
    expect(errors.entries.every((e) => e.level === 'error' && e.project === 'finvault')).toBe(true);
    const text = await api.get<C.LogsData>('/api/logs?q=ECONNREFUSED&range=24h');
    expect(text.entries.length).toBeGreaterThan(0);
    expect(text.entries.every((e) => e.message.toLowerCase().includes('econnrefused'))).toBe(true);
  });

  it('links log lines to monitored services with ids that are stable across calls', async () => {
    const a = await api.get<C.LogsData>('/api/logs?q=healthcheck&range=24h');
    expect(a.entries[0].serviceId).toBe('fv-invoice-service');
    const b = await api.get<C.LogsData>('/api/logs?q=healthcheck&range=24h');
    expect(b.entries.map((e) => e.id)).toEqual(a.entries.map((e) => e.id));
  });

  it('answers 404 for an unknown service and a detail for a known one', async () => {
    expect(await api.status('/api/services/nope')).toBe(404);
    const d = await api.get<C.ServiceDetail>('/api/services/fv-invoice-service');
    expect(d.downSince).not.toBeNull();
    expect(d.service.latencyMs).toBeNull();
    if (live) expect(d.checks.length).toBeLessThanOrEqual(120);
    else expect(d.checks).toHaveLength(120);
  });

  it('persists rule toggles and acknowledgements', async () => {
    expect(await api.status('/api/alert-rules/r8', { method: 'PATCH', body: JSON.stringify({ enabled: true }) })).toBe(204);
    expect(await api.status('/api/alert-rules/nope', { method: 'PATCH', body: JSON.stringify({ enabled: true }) })).toBe(404);
    expect(await api.status('/api/alert-rules/r8', { method: 'PATCH', body: JSON.stringify({ enabled: 'yes' }) })).toBe(400);
    const before = await api.get<C.AlertsData>('/api/alerts');
    expect(before.active.length).toBeGreaterThan(0);
    const id = before.active[0].id;
    expect(await api.status(`/api/alerts/${id}/ack`, { method: 'POST' })).toBe(204);
    const a = await api.get<C.AlertsData>('/api/alerts');
    expect(a.rules.find((r) => r.id === 'r8')?.enabled).toBe(true);
    expect(a.active.find((x) => x.id === id)?.acknowledged).toBe(true);
    expect((await api.get<C.NavCounts>('/api/nav')).openAlerts).toBe(a.active.length);
  });

  it('routes every severity to every configured channel, Telegram included', async () => {
    const s = await api.get<C.SettingsData>('/api/settings');
    const ids = s.channels.map((c) => c.id);
    expect(ids).toContain('telegram');
    for (const severity of ['critical', 'warning', 'info'] as const) {
      expect(Object.keys(s.routing[severity]).sort()).toEqual([...ids].sort());
    }
  });

  it('never returns a channel target it could send to, and stores only the switch', async () => {
    const s = await api.get<C.SettingsData>('/api/settings');
    // No NW_* target is set in these tests: every channel says how to set it up, and is off.
    for (const c of s.channels) {
      expect(c).toMatchObject({ configured: false, source: null, enabled: false });
      expect(c.target).toMatch(/^Not set up — /);
    }
    // PATCH keeps nothing of a channel but its switch: a smuggled target is ignored.
    const flipped = s.channels.map((c) => (c.id === 'telegram' ? { ...c, enabled: true, target: 'https://attacker.example/hook', configured: true } : c));
    expect(await api.status('/api/settings', { method: 'PATCH', body: JSON.stringify({ channels: flipped }) })).toBe(204);
    const after = (await api.get<C.SettingsData>('/api/settings')).channels.find((c) => c.id === 'telegram')!;
    expect(after.configured).toBe(false);
    expect(after.target).not.toContain('attacker');
  });

  it('sets up a channel write-only over PUT, refuses bad input, and removes it with DELETE', async () => {
    const put = (id: string, body: unknown) => api.status(`/api/settings/channels/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    expect(await put('discord', { webhookUrl: 'https://attacker.example/api/webhooks/1/x' })).toBe(422);
    expect(await put('push', { url: 'http://169.254.169.254/topic' })).toBe(422);
    expect(await put('fax', {})).toBe(404);
    expect(await put('discord', { webhookUrl: 'https://discord.com/api/webhooks/42/secret-token-value' })).toBe(204);
    const text = JSON.stringify(await api.get<C.SettingsData>('/api/settings'));
    expect(text).not.toContain('secret-token-value');
    const discord = (await api.get<C.SettingsData>('/api/settings')).channels.find((c) => c.id === 'discord')!;
    expect(discord).toMatchObject({ configured: true, source: 'settings', enabled: true });
    expect(await api.status('/api/settings/channels/discord', { method: 'DELETE' })).toBe(204);
    expect((await api.get<C.SettingsData>('/api/settings')).channels.find((c) => c.id === 'discord')).toMatchObject({ configured: false });
  });

  it('answers a channel test with a result, and 404 for a channel that does not exist', async () => {
    const res = await fetch(`${api.base}/api/settings/channels/discord/test`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, detail: expect.stringContaining('NW_DISCORD_WEBHOOK_URL') });
    expect(await api.status('/api/settings/channels/fax/test', { method: 'POST' })).toBe(404);
  });

  it('stores retention changes and rejects values that are not offered', async () => {
    const s = await api.get<C.SettingsData>('/api/settings');
    const retention = s.retention.map((r) => (r.id === 'logs' ? { ...r, current: '30d' } : r));
    expect(await api.status('/api/settings', { method: 'PATCH', body: JSON.stringify({ retention }) })).toBe(204);
    expect((await api.get<C.SettingsData>('/api/settings')).retention.find((r) => r.id === 'logs')?.current).toBe('30d');
    const bad = s.retention.map((r) => (r.id === 'logs' ? { ...r, current: 'forever' } : r));
    expect(await api.status('/api/settings', { method: 'PATCH', body: JSON.stringify({ retention: bad }) })).toBe(400);
  });

  it('returns a series per configured line for every metric, never padded', async () => {
    for (const id of ['cpu', 'memory', 'disk', 'network', 'queues']) {
      const m = await api.get<C.MetricData>(`/api/metrics/${id}?range=24h`);
      expect(m.id).toBe(id);
      // Live: a metric nobody measured (the fake agent reports no disk; no Docker socket for network)
      // has no series — not zeros and not sample data.
      if (live && (id === 'disk' || id === 'network')) expect(m.series).toEqual([]);
      else expect(m.series.length).toBeGreaterThan(0);
      for (const s of m.series) {
        expect(s.values.length).toBeGreaterThan(0);
        expect(s.values.length).toBeLessThanOrEqual(90);
        if (!live) expect(s.values).toHaveLength(90);
      }
    }
    expect(await api.status('/api/metrics/nope')).toBe(404);
    expect(await api.status('/api/metrics/cpu?range=2h')).toBe(400);
  });

  it('serves every read endpoint of docs/api.md', async () => {
    for (const path of [
      '/api/host', '/api/nav', '/api/metrics?range=24h', '/api/heartbeats', '/api/projects/nexusinfra', '/api/projects/finvault',
      '/api/business', '/api/slos', '/api/incidents', '/api/status',
    ]) {
      await expect(api.get(path)).resolves.toBeTruthy();
    }
    const h = await api.get<C.CollectorHealth>('/health');
    expect(h.version).toBeTruthy();
    expect(await api.get<C.CollectorHealth>('/api/health')).toMatchObject({ live: h.live });
    expect(await api.status('/api/nothing-here')).toBe(404);
  });

  it('serves the incident lifecycle and answers 404/409 like the mocks', async () => {
    const body = (b: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(b) });
    const { incidents } = await api.get<C.IncidentsData>('/api/incidents');
    expect(incidents.length).toBeGreaterThan(0);
    expect(await api.get<C.IncidentDetail>(`/api/incidents/${incidents[0].id}`)).toMatchObject({ id: incidents[0].id });
    expect(await api.status('/api/incidents/nope')).toBe(404);
    const resolved = incidents.find((i) => i.status === 'resolved');
    if (resolved) expect(await api.status(`/api/incidents/${resolved.id}/updates`, body({ status: 'monitoring', message: 'x', public: false }))).toBe(409);
    expect(await api.status('/api/incidents', body({ title: 'Test', severity: 'warning', serviceIds: ['fv-invoice-service'], message: 'Looking', public: false }))).toBe(200);
  });

  it('serves alert-rule, silence, maintenance and escalation writes', async () => {
    const init = (method: string, b?: unknown): RequestInit => ({ method, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    expect(await api.status('/api/alert-rules/nope', init('DELETE'))).toBe(404);
    // Removing a silence, window or policy that is already gone is not an error (idempotent, as in the mocks).
    expect(await api.status('/api/silences/nope', init('DELETE'))).toBe(204);
    expect(await api.status('/api/maintenance-windows/nope', init('DELETE'))).toBe(204);
    expect(await api.status('/api/escalation-policies/nope', init('DELETE'))).toBe(204);
    expect(await api.status('/api/alert-rules/test', init('POST', { project: 'finvault', condition: { metric: 'queue', comparator: '>', threshold: 25, forSeconds: 300 } }))).not.toBe(404);
  });
});

describe('HTTP contract — live specifics', () => {
  let api: Api;
  beforeAll(async () => (api = await serve(await liveCtx())));
  afterAll(() => api.close());

  it('reports live parts and real nodes', async () => {
    const h = await api.get<C.CollectorHealth>('/health');
    expect(h.live).toMatchObject({ services: true, nodes: true, nodeMetrics: true, requests: true, logs: true });
    const hb = await api.get<C.HeartbeatsData>('/api/heartbeats');
    expect(hb.nodes.map((n) => n.id)).toEqual(['node-pi']);
    expect(hb.nodes[0].status).toBe('down');
    expect(hb.nodes[0].gauges.map((g) => g.label)).toEqual(['CPU', 'Memory']);
    expect(hb.monitors.map((m) => m.serviceId)).toEqual(TARGETS.map((t) => t.id));
    expect(hb.incidents.some((i) => i.open && i.title === 'invoice-service is not responding')).toBe(true);
  });

  it('tests a rule against the live checks, and refuses a malformed one', async () => {
    const init = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });
    const res = await fetch(`${api.base}/api/alert-rules/test`, { ...init({ project: 'finvault', condition: { metric: 'latency', comparator: '>', threshold: 100, forSeconds: 0 } }), headers: { 'Content-Type': 'application/json' } });
    const result = (await res.json()) as C.RuleTestResult;
    // api-gateway answers in 140 ms; invoice-service does not answer, which is no data, not 0 ms.
    expect(result.targets.find((t) => t.serviceId === 'fv-api-gateway')).toMatchObject({ state: 'firing', value: 140 });
    expect(result.targets.find((t) => t.serviceId === 'fv-invoice-service')).toMatchObject({ state: 'no_data', value: null });
    expect(await api.status('/api/alert-rules/test', init({ project: 'finvault', condition: { metric: 'nope' } }))).toBe(422);
    expect(await api.status('/api/alert-rules/test', init({}))).toBe(422);
  });

  it('scopes a maintenance window to a monitored service, not to a sample one', async () => {
    const window = { title: 'Gateway upgrade', project: 'finvault', startsAt: new Date().toISOString(), durationMinutes: 30, recurrence: 'none' };
    const init = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });
    expect(await api.status('/api/maintenance-windows', init({ ...window, serviceId: 'fv-account-service' }))).toBe(422);
    const res = await fetch(`${api.base}/api/maintenance-windows`, { ...init({ ...window, serviceId: 'fv-invoice-service' }), headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as C.MaintenanceWindow;
    const a = await api.get<C.AlertsData>('/api/alerts');
    expect(a.services.map((x) => x.id)).toEqual(TARGETS.map((t) => t.id));
    // The open invoice-service outage is now inside the window.
    expect(a.active.find((x) => x.serviceId === 'fv-invoice-service')?.maintenanceId).toBe(id);
    expect(a.summary.inMaintenance).toBe(1);
    expect(await api.status(`/api/maintenance-windows/${id}`, { method: 'DELETE' })).toBe(204);
  });

  it('marks a slow answer slow and leaves unmeasured FinVault rates null', async () => {
    const fv = await api.get<C.FinVaultData>('/api/projects/finvault');
    expect(fv.services.map((s) => s.service.id)).toEqual(['fv-api-gateway', 'fv-invoice-service']);
    expect(fv.services[0].service.status).toBe('slow');
    expect(fv.services[1].p95).toBe('timeout');
    expect(fv.services.every((s) => s.rps === null && s.errorPct === null)).toBe(true);
  });

  it('runs a health check on "Test now", shows the real check interval and NexusInfra agents', async () => {
    const res = await fetch(`${api.base}/api/services/fv-api-gateway/check`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: expect.stringMatching(/^(up|slow|down)$/), at: expect.any(String) });
    expect(await api.status('/api/services/nope/check', { method: 'POST' })).toBe(404);
    expect((await api.get<C.OverviewData>('/api/overview?range=24h')).checkIntervalSeconds).toBe(30);
    expect((await api.get<C.SettingsData>('/api/settings')).agentSource).toBe('nexusinfra');
  });

  it('serves no sample data anywhere once a source is configured', async () => {
    // Names that only exist in the dashboard's sample data.
    const SAMPLE_ONLY = ['game-valheim-02', 'web-mc-04', 'node-02', 'home.example', 'acc_29e', 'tu_8', 'w_3f9a', 'inc_4', 'mnt-finvault-db'];
    for (const path of [
      '/api/host', '/api/nav', '/api/overview?range=24h', '/api/metrics?range=24h', '/api/metrics/network?range=24h', '/api/heartbeats',
      '/api/projects/nexusinfra', '/api/projects/finvault', '/api/business', '/api/slos', '/api/incidents', '/api/status', '/api/settings',
      '/api/alerts', '/api/logs?range=24h',
    ]) {
      const text = JSON.stringify(await api.get<unknown>(path));
      for (const name of SAMPLE_ONLY) expect(text, `${path} contains ${name}`).not.toContain(name);
    }
  });

  it('builds top-ups and payments from the bus, masked, with the unobserved ledger null', async () => {
    const b = await api.get<C.BusinessData>('/api/business');
    expect(b.topUps).toHaveLength(1);
    expect(b.topUps[0]).toMatchObject({ reference: 'topup-u1-a', payer: 't***@e***.com', status: null, credits: null, finvault: { outcome: 'confirmed', amountEur: 25 } });
    for (const t of b.topUps) expect(t.status === null).toBe(t.credits === null);
    expect(JSON.stringify(b)).not.toContain('free text');
    expect(JSON.stringify(b)).not.toContain('tom@example.com');
    const o = await api.get<C.OverviewData>('/api/overview?range=24h');
    expect(o.kpis).toMatchObject({ topupsToday: expect.any(Number), paymentsMonthEur: expect.any(Number) });
    const fv = await api.get<C.FinVaultData>('/api/projects/finvault');
    expect(fv.security).toBeNull();
  });

  it('draws request rates and dead letters from the scrape', async () => {
    const o = await api.get<C.OverviewData>('/api/overview?range=1h');
    expect(o.requests.rps.length).toBeGreaterThan(0);
    expect(Math.max(...o.requests.rps)).toBeCloseTo(100 / 60, 1);
    const q = await api.get<C.MetricData>('/api/metrics/queues?range=1h');
    expect(q.series.map((s) => s.name)).toEqual(['dead-letters']);
  });
});
