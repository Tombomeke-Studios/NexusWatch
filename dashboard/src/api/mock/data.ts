/**
 * Sample data ported from the NexusWatch design. Served while VITE_USE_MOCKS=true.
 * Deterministic (seeded) so screenshots and tests are stable; timestamps are relative to "now".
 */
import { rng, walk } from '@/lib/series';
import {
  draftFromRule, evaluateRule, silenceEndsAt, validateDraft, validatePolicy, validateReason, validateWindow, windowCovers,
  type Reading,
} from '@/lib/rules';
import { maskChannelTarget, validateChannelConfig } from '@/lib/channels';
import { ApiError } from '../client';
import type {
  ActiveAlert, Agent, AlertHistoryItem, AlertRule, AlertsData, Channel, ContainerRow, ContainerUsage,
  FinVaultData, HealthStatus, HeartbeatsData, HostInfo, LogEntry, LogLevel, LogQuery, LogsData,
  MetricData, MetricId, MetricsOverview, Monitor, NavCounts, NexusInfraData, NodeSummary, OverviewData,
  ProjectId, ServiceCheckResult, ServiceDetail, ServiceSummary, SettingsData,
} from '../types';
import { incidentSummaries } from './reliability';
import type { AccountStanding, BusinessData, ChannelTestResult, PlanRevenue, TopUpRecord } from '../types';
import type {
  AlertNote, AlertRuleInput, EscalationPolicy, EscalationPolicyInput, MaintenanceInput, MaintenanceWindow, RuleCondition,
  RuleMetric, RuleTestResult, Silence, SilenceInput,
} from '../types';

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const ago = (seconds: number): string => new Date(Date.now() - seconds * 1000).toISOString();

// ── Services ───────────────────────────────────────────────────────────
function beats(seed: number, bad: number, warn: number, n = 48): HealthStatus[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    if (bad && i >= n - bad) return 'down';
    if (warn && r() < warn) return 'slow';
    return 'up';
  });
}

function svc(id: string, name: string, project: ProjectId, port: string, status: HealthStatus, latencyMs: number | null, uptimePct: number, seed: number, bad = 0, warn = 0): ServiceSummary {
  return { id, name, project, port, status, latencyMs, uptimePct, beats: beats(seed, bad, warn) };
}

export const services: ServiceSummary[] = [
  svc('nx-api-gateway', 'api-gateway', 'nexusinfra', ':4000', 'up', 42, 99.98, 11),
  svc('nx-orchestrator', 'orchestrator', 'nexusinfra', ':4001', 'up', 63, 99.95, 12, 0, 0.02),
  svc('nx-control-room', 'control-room', 'nexusinfra', ':4002', 'up', 51, 99.97, 13),
  svc('nx-agent-node-01', 'node-agent · node-01', 'nexusinfra', ':4100', 'up', 18, 99.99, 14),
  svc('nx-agent-node-02', 'node-agent · node-02', 'nexusinfra', ':4100', 'slow', 140, 98.21, 15, 0, 0.3),
  svc('nx-rabbitmq', 'rabbitmq', 'nexusinfra', ':5672', 'up', 9, 100, 16),
  svc('fv-api-gateway', 'api-gateway', 'finvault', ':8000', 'up', 38, 99.96, 21, 0, 0.01),
  svc('fv-account-service', 'account-service', 'finvault', ':8001', 'up', 47, 99.94, 22, 0, 0.02),
  svc('fv-wallet-service', 'wallet-service', 'finvault', ':8002', 'up', 55, 99.93, 23, 0, 0.02),
  svc('fv-invoice-service', 'invoice-service', 'finvault', ':8003', 'down', null, 96.4, 24, 6, 0.05),
  svc('nx-billing-bridge', 'billing-bridge', 'nexusinfra', ':4200', 'up', 71, 99.9, 25, 0, 0.02),
];

const byId = (id: string) => services.find((s) => s.id === id);

// ── Shell ──────────────────────────────────────────────────────────────
export function host(): HostInfo {
  return { name: 'home-server', address: '192.168.1.20', uptimeSeconds: 14 * DAY + 6 * HOUR, nodesConnected: 3, online: true };
}

export function navCounts(): NavCounts {
  return { openAlerts: activeAlerts().length, services: { nexusinfra: 6, finvault: 5 } };
}

// ── Logs ───────────────────────────────────────────────────────────────
const PROJECT_OF: Record<string, ProjectId> = {
  'invoice-service': 'finvault', 'wallet-service': 'finvault', 'account-service': 'finvault', 'api-gateway': 'finvault',
  'billing-bridge': 'nexusinfra', rabbitmq: 'nexusinfra', 'node-01': 'nexusinfra', 'node-02': 'nexusinfra', nexusinfra: 'nexusinfra', finvault: 'finvault',
};

/** Stable id from the line's content, so the same line has the same id on every poll and every page. */
function logId(...parts: (string | number)[]): string {
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `log_${h.toString(36)}`;
}

function log(secondsAgo: number, level: LogLevel, service: string, message: string, node = 'node-01', extra: LogEntry['fields'] = {}, project: ProjectId = PROJECT_OF[service] ?? 'nexusinfra'): LogEntry {
  const serviceId = services.find((s) => s.name === service && s.project === project)?.id;
  return {
    id: logId(service, secondsAgo, message),
    time: ago(secondsAgo),
    level, service, serviceId, project, node, message,
    fields: { level, service, project, message, node, ...extra },
  };
}

const logEntries: LogEntry[] = [
  log(4, 'error', 'invoice-service', 'healthcheck failed: ECONNREFUSED 127.0.0.1:8003', 'node-01', { consecutiveFailures: 6 }),
  log(34, 'error', 'invoice-service', 'healthcheck failed: ECONNREFUSED 127.0.0.1:8003', 'node-01', { consecutiveFailures: 5 }),
  log(42, 'warn', 'rabbitmq', 'queue invoice.events consumers=0 ready=42', 'node-03'),
  log(80, 'warn', 'wallet-service', 'publish invoice.created retried (attempt 3/5)'),
  log(92, 'warn', 'api-gateway', 'upstream invoice-service slow: 5012 ms'),
  log(190, 'error', 'invoice-service', 'unhandled rejection: Prisma P1001 cannot reach database'),
  log(268, 'warn', 'account-service', 'rate limit near threshold for ip 10.0.0.14 (92/100)', 'node-02'),
  log(660, 'warn', 'billing-bridge', 'webhook topup.settled delivered after 2 retries'),
  log(942, 'warn', 'wallet-service', 'fx rate cache older than 15 min, refreshing'),
  log(1625, 'warn', 'rabbitmq', 'queue wallet.events ready=42 above threshold 25', 'node-03'),
  log(2541, 'error', 'api-gateway', 'POST /invoices 502 bad gateway (upstream timeout)'),
  log(3119, 'warn', 'account-service', 'refresh token reuse detected, session revoked', 'node-02'),
  log(3913, 'warn', 'wallet-service', 'SEPA transfer pending > 60 s, ref tx_8a1c'),
  log(4607, 'error', 'invoice-service', 'EPC069-12 qr generation failed: missing iban'),
];

export function logs(q: LogQuery): LogsData {
  const text = q.query.trim().toLowerCase();
  const entries = logEntries.filter(
    (e) =>
      (q.levels.length === 0 || q.levels.includes(e.level)) &&
      (!q.project || e.project === q.project) &&
      (!text || e.message.toLowerCase().includes(text) || e.service.includes(text)),
  );
  const r = rng(77);
  const histogram = Array.from({ length: 48 }, (_, i) => {
    const total = 18 + r() * 60 + (i > 38 ? 20 : 0);
    const errorShare = (i > 41 ? 0.55 : 0.12) * r() + 0.05;
    return { error: Math.round(total * errorShare), warn: Math.round(total * (0.3 * r() + 0.12)) };
  });
  return {
    total: 1284,
    histogram,
    facets: {
      level: [{ value: 'error', count: 214 }, { value: 'warn', count: 1070 }],
      service: [
        { value: 'invoice-service', count: 311 }, { value: 'wallet-service', count: 287 }, { value: 'api-gateway', count: 240 },
        { value: 'account-service', count: 198 }, { value: 'rabbitmq', count: 148 }, { value: 'billing-bridge', count: 100 },
      ],
      node: [{ value: 'node-01', count: 902 }, { value: 'node-02', count: 311 }, { value: 'node-03', count: 71 }],
    },
    entries,
  };
}

// ── Overview ───────────────────────────────────────────────────────────
export function overview(): OverviewData {
  const events: LogEntry[] = [
    log(4, 'error', 'finvault', 'invoice-service is not responding: 6 checks failed in a row'),
    log(92, 'warn', 'nexusinfra', 'node-02 heartbeat delayed, 140 ms (threshold 100 ms)', 'node-02'),
    log(260, 'info', 'finvault', 'Top-up €25.00 processed for wallet w_3f9a'),
    log(650, 'ok', 'nexusinfra', 'Container web-mc-04 started on node-01'),
    log(955, 'info', 'billing-bridge', 'Payment €6.50 received for server srv_21'),
    log(1629, 'warn', 'rabbitmq', 'RabbitMQ queue wallet.events has 42 messages waiting', 'node-03'),
    log(2652, 'ok', 'node-01', 'Backup of database finvault.db completed'),
  ];
  return {
    kpis: {
      servicesUp: services.filter((s) => s.status === 'up').length,
      servicesTotal: services.length,
      servicesSlow: services.filter((s) => s.status === 'slow').length,
      servicesDown: services.filter((s) => s.status === 'down').length,
      p95Ms: 84,
      p95Trend: walk(3, 30, 55, 30),
      openAlerts: 2,
      openAlertsSummary: 'invoice-service down · node-02 slow',
      topupsToday: 38,
      topupsTrend: walk(7, 30, 40, 36, { drift: 0.8 }),
      paymentsMonthEur: 312,
      paymentsTrend: walk(9, 30, 30, 20, { drift: 1.4 }),
    },
    services,
    events,
    cpuByNode: [
      { name: 'node-01', color: 'nx', values: walk(31, 60, 38, 14) },
      { name: 'node-02', color: 'sky', values: walk(32, 60, 55, 22, { drift: 0.25 }) },
      { name: 'node-03', color: 'vi', values: walk(33, 60, 22, 8) },
    ],
    requests: { rps: walk(41, 60, 48, 18), errors5xx: walk(42, 60, 4, 3) },
    topupsPerHour: walk(51, 24, 45, 40),
    paymentsPerDay: walk(52, 30, 40, 35),
    checkIntervalSeconds: 30,
  };
}

/** "Test now" on a sample service: its current state, as a fresh check. */
export function checkService(id: string): ServiceCheckResult {
  const s = byId(id);
  if (!s) throw new ApiError(404, `Service ${id} not found`);
  const latencyMs = s.status === 'down' ? null : s.latencyMs;
  return { at: new Date().toISOString(), status: s.status, latencyMs, note: s.status === 'down' ? 'connect ECONNREFUSED' : 'HTTP 200' };
}

// ── Metrics ────────────────────────────────────────────────────────────
const METRICS: Record<MetricId, Omit<MetricData, 'series'> & { s: [string, MetricData['series'][number]['color'], number, number, number, number][] }> = {
  cpu: { id: 'cpu', label: 'CPU', title: 'CPU usage per node', description: '5-minute average', unit: '%', max: 100, query: 'avg by (node) (rate(node_cpu_seconds_total{mode!="idle"}[5m]))',
    s: [['node-01', 'nx', 31, 38, 14, 0], ['node-02', 'sky', 32, 55, 22, 0.25], ['node-03', 'vi', 33, 22, 8, 0]] },
  memory: { id: 'memory', label: 'Memory', title: 'Memory usage per node', description: 'resident set, including cache', unit: '%', max: 100, query: 'node_memory_used_bytes / node_memory_total_bytes',
    s: [['node-01', 'nx', 41, 58, 6, 0.05], ['node-02', 'sky', 42, 70, 8, 0.2], ['node-03', 'vi', 43, 40, 5, 0]] },
  disk: { id: 'disk', label: 'Disk', title: 'Disk usage', description: 'used space on the root volume', unit: '%', max: 100, query: 'node_filesystem_used_ratio{mountpoint="/"}',
    s: [['node-01', 'nx', 51, 44, 1.2, 0.05], ['node-02', 'sky', 52, 52, 1.5, 0.08], ['node-03', 'vi', 53, 28, 1, 0.02]] },
  network: { id: 'network', label: 'Network', title: 'Network traffic', description: 'throughput in Mbit/s', unit: 'Mbit/s', max: 100, query: 'sum by (direction) (rate(node_network_bytes_total[1m]))',
    s: [['inbound', 'fv', 61, 30, 25, 0], ['outbound', 'nx', 62, 22, 18, 0]] },
  queues: { id: 'queues', label: 'Queues', title: 'RabbitMQ queue depth', description: 'messages waiting per queue', unit: 'msg', max: 100, query: 'rabbitmq_queue_messages_ready{vhost="/"}',
    s: [['account.events', 'fv', 71, 8, 6, 0], ['wallet.events', 'vi', 72, 18, 16, 0.2], ['invoice.events', 'down', 73, 12, 10, 0.5]] },
};

export const metricIds = Object.keys(METRICS) as MetricId[];

export function metric(id: MetricId): MetricData {
  const { s, ...rest } = METRICS[id];
  return { ...rest, series: s.map(([name, color, seed, base, amp, drift]) => ({ name, color, values: walk(seed, 90, base, amp, { drift }) })) };
}

export function metricsOverview(): MetricsOverview {
  const c = (name: string, project: ProjectId, node: string, cpuPct: number, memoryBytes: number): ContainerUsage => ({ name, project, node, cpuPct, memoryBytes });
  return {
    summaries: [
      { title: 'CPU total', value: '34', unit: '%', delta: '+2 pt', tone: 'mute', color: 'nx', trend: walk(81, 40, 36, 12) },
      { title: 'Memory', value: '19.5', unit: 'GB', delta: '+0.4 GB', tone: 'mute', color: 'sky', trend: walk(82, 40, 55, 6) },
      { title: 'Disk IO', value: '42', unit: 'MB/s', delta: '-8%', tone: 'ok', color: 'vi', trend: walk(83, 40, 40, 22) },
      { title: 'Network in', value: '31', unit: 'Mbit/s', delta: '+12%', tone: 'warn', color: 'fv', trend: walk(84, 40, 30, 25) },
      { title: 'Containers running', value: '12', unit: '', delta: '+1', tone: 'info', color: 'nx', trend: walk(85, 40, 50, 4) },
      { title: 'Queue depth', value: '42', unit: 'msg', delta: '+30', tone: 'down', color: 'down', trend: walk(86, 40, 20, 20) },
    ],
    topContainers: [
      c('game-valheim-02', 'nexusinfra', 'node-02', 78, 3.1 * GB), c('web-mc-04', 'nexusinfra', 'node-01', 54, 2.2 * GB),
      c('finvault-wallet', 'finvault', 'node-01', 41, 412 * MB), c('postgres-01', 'nexusinfra', 'node-01', 33, 1.4 * GB),
      c('finvault-gateway', 'finvault', 'node-01', 18, 188 * MB), c('rabbitmq', 'nexusinfra', 'node-03', 11, 320 * MB),
    ],
  };
}

// ── Heartbeats ─────────────────────────────────────────────────────────
const gauge = (label: string, pct: number, text: string) => ({ label, pct, text });

export const nodes: NodeSummary[] = [
  { id: 'node-01', name: 'node-01', status: 'up', host: '192.168.1.20', lastBeatSeconds: 4, containers: 7, agentVersion: 'v0.9.2', gauges: [gauge('CPU', 38, '38%'), gauge('Memory', 61, '19.5 / 32 GB'), gauge('Disk', 47, '470 / 1000 GB')] },
  { id: 'node-02', name: 'node-02', status: 'slow', host: 'vm-laptop', lastBeatSeconds: 12, containers: 3, agentVersion: 'v0.9.2', gauges: [gauge('CPU', 78, '78%'), gauge('Memory', 82, '6.6 / 8 GB'), gauge('Disk', 55, '22 / 40 GB')] },
  { id: 'node-03', name: 'node-03', status: 'up', host: 'vm-desktop', lastBeatSeconds: 3, containers: 2, agentVersion: 'v0.9.1', gauges: [gauge('CPU', 21, '21%'), gauge('Memory', 44, '3.5 / 8 GB'), gauge('Disk', 30, '12 / 40 GB')] },
];

function days(seed: number, down: number[], warn: number[]): HealthStatus[] {
  const r = rng(seed);
  return Array.from({ length: 60 }, (_, i) => (down.includes(i) ? 'down' : warn.includes(i) || r() < 0.015 ? 'slow' : 'up'));
}

function monitor(serviceId: string, target: string, seed: number, down: number[], warn: number[], avgLatencyMs: number): Monitor {
  const s = byId(serviceId)!;
  return { id: `mon_${serviceId}`, serviceId, name: s.name, project: s.project, target, uptimePct: s.uptimePct, status: s.status, avgLatencyMs, nowLatencyMs: s.latencyMs, days: days(seed, down, warn) };
}

export function heartbeats(): HeartbeatsData {
  return {
    nodes,
    monitors: [
      monitor('nx-api-gateway', 'http://nexusinfra:4000/health', 1, [], [14, 41], 44),
      monitor('nx-orchestrator', 'http://nexusinfra:4001/health', 2, [], [22], 61),
      monitor('nx-agent-node-02', 'tcp://vm-laptop:4100', 3, [33], [51, 52, 57, 58, 59], 96),
      monitor('fv-api-gateway', 'http://finvault:8000/health', 4, [], [8], 39),
      monitor('fv-wallet-service', 'http://finvault:8002/health', 5, [], [19, 20], 56),
      monitor('fv-invoice-service', 'http://finvault:8003/health', 6, [27, 59], [26], 51),
    ],
    incidents: incidentSummaries(),
  };
}

// ── Alerts ─────────────────────────────────────────────────────────────
// In-memory alerting state: rules, policies, silences, maintenance windows, acks, resolutions, notes.
let idCounter = 100;
const nextId = (prefix: string) => `${prefix}_${++idCounter}`;
const invalid = (message: string) => new ApiError(422, message);

const policies: EscalationPolicy[] = [
  { id: 'ep_oncall', name: 'On-call', steps: [{ channel: 'discord', afterMinutes: 0 }, { channel: 'telegram', afterMinutes: 5 }, { channel: 'push', afterMinutes: 15 }] },
  { id: 'ep_office', name: 'Office hours', steps: [{ channel: 'email', afterMinutes: 0 }, { channel: 'discord', afterMinutes: 30 }] },
];

const C = (metric: RuleMetric, comparator: RuleCondition['comparator'], threshold: number, forSeconds: number): RuleCondition => ({ metric, comparator, threshold, forSeconds });
const RUNBOOKS = 'https://wiki.home.example/runbooks';
const rules: AlertRule[] = [
  { id: 'r1', name: 'Service down', project: 'nexusinfra', condition: C('heartbeat', '==', 0, 90), severity: 'critical', channels: ['discord', 'push'], escalationPolicyId: 'ep_oncall', runbookUrl: `${RUNBOOKS}/service-down`, enabled: true },
  { id: 'r2', name: 'Service down', project: 'finvault', condition: C('heartbeat', '==', 0, 90), severity: 'critical', channels: ['discord', 'push'], escalationPolicyId: 'ep_oncall', runbookUrl: `${RUNBOOKS}/service-down`, enabled: true },
  { id: 'r3', name: 'Disk almost full', project: 'nexusinfra', condition: C('disk', '>', 90, 15 * MIN), severity: 'critical', channels: ['discord', 'push'], escalationPolicyId: 'ep_oncall', runbookUrl: '', enabled: true },
  { id: 'r4', name: 'Slow heartbeat', project: 'nexusinfra', condition: C('latency', '>', 100, 5 * MIN), severity: 'warning', channels: ['discord'], escalationPolicyId: 'ep_office', runbookUrl: '', enabled: true },
  { id: 'r5', name: 'High CPU', project: 'nexusinfra', condition: C('cpu', '>', 85, 10 * MIN), severity: 'warning', channels: ['discord'], escalationPolicyId: null, runbookUrl: '', enabled: true },
  { id: 'r6', name: 'Queue backing up', project: 'finvault', condition: C('queue_depth', '>', 25, 5 * MIN), severity: 'warning', channels: ['discord'], escalationPolicyId: null, runbookUrl: `${RUNBOOKS}/queues`, enabled: true },
  { id: 'r7', name: '5xx error rate', project: 'finvault', condition: C('error_rate', '>', 2, 5 * MIN), severity: 'warning', channels: ['email'], escalationPolicyId: 'ep_office', runbookUrl: '', enabled: true },
  { id: 'r8', name: 'No top-ups', project: 'finvault', condition: C('topups', '==', 0, 6 * HOUR), severity: 'info', channels: ['email'], escalationPolicyId: null, runbookUrl: '', enabled: false },
];

const acknowledgedAt = new Map<string, string>();
const resolvedAt = new Map<string, string>();
const alertNotes = new Map<string, AlertNote[]>();

const silences: Silence[] = [
  { id: 'sil_1', kind: 'rule', targetId: 'r7', label: '5xx error rate (FinVault)', reason: 'Known spike while the gateway redeploys', createdAt: ago(20 * MIN), endsAt: new Date(Date.now() + 40 * MIN * 1000).toISOString() },
];

/** This week's Sunday, 03:00 UTC: anchors the weekly backup window. */
function sundayThreeAm(): string {
  const d = new Date();
  d.setUTCHours(3, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString();
}

const maintenance: MaintenanceWindow[] = [
  { id: 'mw_1', title: 'node-02 memory upgrade', project: 'nexusinfra', serviceId: 'nx-agent-node-02', startsAt: ago(40 * MIN), durationMinutes: 120, recurrence: 'none' },
  { id: 'mw_2', title: 'account-service database backup', project: 'finvault', serviceId: 'fv-account-service', startsAt: sundayThreeAm(), durationMinutes: 60, recurrence: 'weekly' },
];

const note = (kind: AlertNote['kind'], text: string, secondsAgo: number): AlertNote => ({ id: nextId('note'), kind, text, at: ago(secondsAgo) });

/** The alerts the sample data has fired, before acks, silences and resolutions are applied. */
const FIRED = [
  { id: 'al_1', ruleId: 'r2', severity: 'critical' as const, project: 'finvault' as const, serviceId: 'fv-invoice-service', title: 'invoice-service is not responding',
    description: 'The health check on :8003 returns ECONNREFUSED. The invoice.events queue is growing and invoices are not being processed.',
    rule: 'heartbeat{service="invoice-service"} == 0 for 90s', startedSeconds: 16 * MIN, value: 'timeout', trend: walk(5, 40, 60, 6, { drift: -1.4 }) },
  { id: 'al_2', ruleId: 'r4', severity: 'warning' as const, project: 'nexusinfra' as const, serviceId: 'nx-agent-node-02', title: 'node-02 is slow',
    description: 'Heartbeat latency and CPU are above the threshold. The VM may be short on memory.',
    rule: 'latency_ms{service="node-agent · node-02"} > 100 for 5m', startedSeconds: 32 * MIN, value: '140 ms', trend: walk(6, 40, 50, 10, { drift: 0.9 }) },
];

/** Drops silences that ran out, and "until resolved" silences whose alerts have resolved. */
function pruneSilences(): void {
  const now = Date.now();
  const open = FIRED.filter((a) => !resolvedAt.has(a.id));
  for (let i = silences.length - 1; i >= 0; i--) {
    const s = silences[i];
    const expired = s.endsAt !== null && Date.parse(s.endsAt) <= now;
    const resolved = s.endsAt === null && (s.kind === 'alert' ? resolvedAt.has(s.targetId) : !open.some((a) => a.ruleId === s.targetId));
    if (expired || resolved) silences.splice(i, 1);
  }
}

function activeAlerts(): ActiveAlert[] {
  pruneSilences();
  const now = Date.now();
  return FIRED.filter((a) => !resolvedAt.has(a.id)).map(({ startedSeconds, ...a }) => ({
    ...a,
    startedAt: ago(startedSeconds),
    durationSeconds: startedSeconds,
    acknowledged: acknowledgedAt.has(a.id),
    acknowledgedAt: acknowledgedAt.get(a.id) ?? null,
    silenceId: silences.find((s) => (s.kind === 'alert' && s.targetId === a.id) || (s.kind === 'rule' && s.targetId === a.ruleId))?.id ?? null,
    maintenanceId: maintenance.find((w) => windowCovers(w, a, now))?.id ?? null,
    notes: [...(alertNotes.get(a.id) ?? [])],
  }));
}

const PAST_HISTORY: AlertHistoryItem[] = [
  { id: 'h3', open: false, title: 'Queue wallet.events backing up', project: 'finvault', severity: 'warning', startedAt: ago(13 * HOUR), durationSeconds: 12 * MIN, notes: [note('acknowledged', 'Restarting the wallet consumer', 13 * HOUR - 3 * MIN), note('resolved', 'Consumer back, queue drained', 13 * HOUR - 12 * MIN)] },
  { id: 'h4', open: false, title: 'High CPU on node-02', project: 'nexusinfra', severity: 'warning', startedAt: ago(17 * HOUR), durationSeconds: 27 * MIN, notes: [] },
  { id: 'h5', open: false, title: '5xx error rate above 2%', project: 'finvault', severity: 'warning', startedAt: ago(2 * DAY), durationSeconds: 6 * MIN, notes: [] },
  { id: 'h6', open: false, title: 'node-agent node-02 offline', project: 'nexusinfra', severity: 'critical', startedAt: ago(2 * DAY + 8 * HOUR), durationSeconds: 8 * MIN, notes: [note('resolved', 'VM rebooted after a kernel update', 2 * DAY + 8 * HOUR - 8 * MIN)] },
  { id: 'h7', open: false, title: 'Slow heartbeat api-gateway', project: 'nexusinfra', severity: 'warning', startedAt: ago(3 * DAY), durationSeconds: 4 * MIN, notes: [] },
];

function history(): AlertHistoryItem[] {
  const fired = FIRED.map((a, i): AlertHistoryItem => {
    const resolved = resolvedAt.get(a.id);
    const startedMs = Date.now() - a.startedSeconds * 1000;
    return {
      id: `h${i + 1}`, alertId: a.id, open: !resolved, title: a.title, project: a.project, severity: a.severity, startedAt: ago(a.startedSeconds),
      durationSeconds: resolved ? Math.max(0, Math.round((Date.parse(resolved) - startedMs) / 1000)) : a.startedSeconds,
      notes: [...(alertNotes.get(a.id) ?? [])],
    };
  });
  return [...fired, ...PAST_HISTORY.map((h) => ({ ...h, notes: [...h.notes] }))];
}

export function alerts(): AlertsData {
  const active = activeAlerts();
  return {
    summary: {
      critical: active.filter((a) => a.severity === 'critical').length,
      warning: active.filter((a) => a.severity === 'warning').length,
      muted: silences.length,
      inMaintenance: active.filter((a) => a.maintenanceId).length,
      resolved24h: 5 + resolvedAt.size,
      resolvedAuto24h: 3,
      mttrMinutes: 14,
    },
    active,
    rules: rules.map((r) => structuredClone(r)),
    history: history(),
    silences: silences.map((s) => ({ ...s })),
    maintenance: maintenance.map((w) => ({ ...w })),
    policies: policies.map((p) => structuredClone(p)),
    services: services.map(({ id, name, project }) => ({ id, name, project })),
  };
}

function firedAlert(id: string) {
  const a = FIRED.find((x) => x.id === id && !resolvedAt.has(x.id));
  if (!a) throw new ApiError(404, `Alert ${id} is not active`);
  return a;
}

function addNote(alertId: string, kind: AlertNote['kind'], text = ''): void {
  alertNotes.set(alertId, [...(alertNotes.get(alertId) ?? []), { id: nextId('note'), kind, text: text.trim(), at: new Date().toISOString() }]);
}

/** Acknowledging stops the escalation; the optional note lands in the alert's history. */
export function acknowledgeAlert(id: string, noteText = ''): void {
  firedAlert(id);
  if (acknowledgedAt.has(id)) return;
  acknowledgedAt.set(id, new Date().toISOString());
  addNote(id, 'acknowledged', noteText);
}

export function resolveAlert(id: string, noteText = ''): void {
  firedAlert(id);
  resolvedAt.set(id, new Date().toISOString());
  addNote(id, 'resolved', noteText);
  pruneSilences();
}

function checkRule(input: AlertRuleInput): AlertRuleInput {
  const { errors, rule } = validateDraft(draftFromRule({ ...input, id: '' }));
  if (!rule) throw invalid(Object.values(errors)[0] ?? 'Invalid rule');
  if (input.escalationPolicyId && !policies.some((p) => p.id === input.escalationPolicyId)) throw invalid('Unknown escalation policy');
  return rule;
}

export function createRule(input: AlertRuleInput): AlertRule {
  const rule = { id: nextId('r'), ...checkRule(input) };
  rules.push(rule);
  return structuredClone(rule);
}

export function updateRule(id: string, input: AlertRuleInput): AlertRule {
  const i = rules.findIndex((r) => r.id === id);
  if (i < 0) throw new ApiError(404, `Rule ${id} not found`);
  rules[i] = { id, ...checkRule(input) };
  return structuredClone(rules[i]);
}

/** Deleting a rule also lifts the silences on it. */
export function deleteRule(id: string): void {
  const i = rules.findIndex((r) => r.id === id);
  if (i < 0) throw new ApiError(404, `Rule ${id} not found`);
  rules.splice(i, 1);
  for (let j = silences.length - 1; j >= 0; j--) if (silences[j].kind === 'rule' && silences[j].targetId === id) silences.splice(j, 1);
}

export function setRuleEnabled(id: string, enabled: boolean): void {
  const rule = rules.find((r) => r.id === id);
  if (rule) rule.enabled = enabled;
}

/** Current samples per target and metric, as the collector would hold them. Unknown answers stay null. */
export function readings(): { metric: RuleMetric; reading: Reading }[] {
  const out: { metric: RuleMetric; reading: Reading }[] = [];
  const add = (metric: RuleMetric, reading: Reading) => out.push({ metric, reading });
  for (const s of services) {
    const base = { target: s.name, project: s.project, serviceId: s.id, stepSeconds: 30 };
    add('heartbeat', { ...base, samples: s.beats.map((b) => (b === 'down' ? 0 : 1)) });
    add('latency', { ...base, samples: s.beats.slice(-20).map((b) => (b === 'down' ? null : s.latencyMs)) });
  }
  const GAUGE_METRIC: Record<string, RuleMetric> = { CPU: 'cpu', Memory: 'memory', Disk: 'disk' };
  for (const n of nodes) {
    for (const g of n.gauges) {
      const samples = walk(n.name.length * 7 + g.label.length, 30, g.pct, 3, { min: Math.max(0, g.pct - 3), max: Math.min(100, g.pct + 3) });
      samples[samples.length - 1] = g.pct;
      add(GAUGE_METRIC[g.label], { target: `${n.name} ${g.label.toLowerCase()}`, project: 'nexusinfra', samples, stepSeconds: 60 });
    }
  }
  const fv = finVault();
  for (const q of fv.queues) {
    // wallet.events has only just crossed its threshold: a rule with "for 5m" is still pending.
    const samples = q.ready > q.threshold ? [18, 19, 21, 22, 24, 31, 38, q.ready] : Array.from({ length: 8 }, () => q.ready);
    add('queue_depth', { target: q.name, project: 'finvault', samples, stepSeconds: 60 });
  }
  for (const s of fv.services) add('error_rate', { target: s.service.name, project: s.service.project, serviceId: s.service.id, samples: Array.from({ length: 10 }, () => s.errorPct), stepSeconds: 60 });
  add('topups', { target: 'top-ups', project: 'finvault', samples: fv.topupsPerHour.slice(-24), stepSeconds: HOUR });
  return out;
}

/** Evaluates a rule (saved or not) against the current sample data. */
export function testRule(input: Pick<AlertRuleInput, 'project' | 'condition'>): RuleTestResult {
  const relevant = readings().filter((r) => r.metric === input.condition.metric).map((r) => r.reading);
  const { fires, targets } = evaluateRule(input, relevant);
  return { evaluatedAt: new Date().toISOString(), fires, targets };
}

export function createSilence(input: SilenceInput): Silence {
  const reasonError = validateReason(input.reason);
  if (reasonError) throw invalid(reasonError);
  let label: string;
  if (input.kind === 'alert') {
    label = firedAlert(input.targetId).title;
  } else {
    const rule = rules.find((r) => r.id === input.targetId);
    if (!rule) throw new ApiError(404, `Rule ${input.targetId} not found`);
    if (input.duration === 'resolved' && !activeAlerts().some((a) => a.ruleId === rule.id)) throw invalid('This rule has no active alert to wait for');
    label = `${rule.name} (${rule.project === 'finvault' ? 'FinVault' : 'NexusInfra'})`;
  }
  const silence: Silence = { id: nextId('sil'), kind: input.kind, targetId: input.targetId, label, reason: input.reason.trim(), createdAt: new Date().toISOString(), endsAt: silenceEndsAt(input.duration, Date.now()) };
  silences.push(silence);
  return { ...silence };
}

export function deleteSilence(id: string): void {
  const i = silences.findIndex((s) => s.id === id);
  if (i >= 0) silences.splice(i, 1);
}

/** The services a window may be scoped to. The collector passes the monitored ones; the sample has its own. */
type KnownServices = readonly { id: string; project: ProjectId }[];

function checkWindow(input: MaintenanceInput, known: KnownServices): MaintenanceInput {
  const first = Object.values(validateWindow(input))[0];
  if (first) throw invalid(first);
  if (input.serviceId && known.find((s) => s.id === input.serviceId)?.project !== input.project) throw invalid('That service is not part of this project');
  return { ...input, title: input.title.trim(), startsAt: new Date(input.startsAt).toISOString() };
}

export function createMaintenance(input: MaintenanceInput, known: KnownServices = services): MaintenanceWindow {
  const w = { id: nextId('mw'), ...checkWindow(input, known) };
  maintenance.push(w);
  return { ...w };
}

export function updateMaintenance(id: string, input: MaintenanceInput, known: KnownServices = services): MaintenanceWindow {
  const i = maintenance.findIndex((w) => w.id === id);
  if (i < 0) throw new ApiError(404, `Maintenance window ${id} not found`);
  maintenance[i] = { id, ...checkWindow(input, known) };
  return { ...maintenance[i] };
}

export function deleteMaintenance(id: string): void {
  const i = maintenance.findIndex((w) => w.id === id);
  if (i >= 0) maintenance.splice(i, 1);
}

function checkPolicy(input: EscalationPolicyInput): EscalationPolicyInput {
  const first = Object.values(validatePolicy(input))[0];
  if (first) throw invalid(first);
  return { name: input.name.trim(), steps: input.steps.map((s) => ({ ...s })) };
}

export function createPolicy(input: EscalationPolicyInput): EscalationPolicy {
  const p = { id: nextId('ep'), ...checkPolicy(input) };
  policies.push(p);
  return structuredClone(p);
}

export function updatePolicy(id: string, input: EscalationPolicyInput): EscalationPolicy {
  const i = policies.findIndex((p) => p.id === id);
  if (i < 0) throw new ApiError(404, `Escalation policy ${id} not found`);
  policies[i] = { id, ...checkPolicy(input) };
  return structuredClone(policies[i]);
}

/** Deleting a policy detaches it from every rule that used it. */
export function deletePolicy(id: string): void {
  const i = policies.findIndex((p) => p.id === id);
  if (i >= 0) policies.splice(i, 1);
  for (const r of rules) if (r.escalationPolicyId === id) r.escalationPolicyId = null;
}

/**
 * Everything the alerting writes change, as plain JSON. The collector stores it so rules, silences,
 * maintenance windows, policies, acknowledgements and notes survive a restart.
 */
export interface AlertingState {
  idCounter: number;
  policies: EscalationPolicy[];
  rules: AlertRule[];
  silences: Silence[];
  maintenance: MaintenanceWindow[];
  acknowledgedAt: [alertId: string, at: string][];
  resolvedAt: [alertId: string, at: string][];
  notes: [alertId: string, notes: AlertNote[]][];
}

export function alertingState(): AlertingState {
  return structuredClone({
    idCounter, policies, rules, silences, maintenance,
    acknowledgedAt: [...acknowledgedAt], resolvedAt: [...resolvedAt], notes: [...alertNotes],
  });
}

const refill = <K, V>(map: Map<K, V>, entries: [K, V][]) => {
  map.clear();
  for (const [k, v] of entries) map.set(k, v);
};

/** Replaces the alerting state with a snapshot from `alertingState()`. */
export function restoreAlertingState(state: AlertingState): void {
  const s = structuredClone(state);
  idCounter = Math.max(idCounter, s.idCounter);
  policies.splice(0, policies.length, ...s.policies);
  rules.splice(0, rules.length, ...s.rules);
  silences.splice(0, silences.length, ...s.silences);
  maintenance.splice(0, maintenance.length, ...s.maintenance);
  refill(acknowledgedAt, s.acknowledgedAt);
  refill(resolvedAt, s.resolvedAt);
  refill(alertNotes, s.notes);
}

// ── Service detail ─────────────────────────────────────────────────────
export function serviceDetail(id: string): ServiceDetail | null {
  const service = byId(id);
  if (!service) return null;
  const isDown = service.status === 'down';
  const r = rng(123);
  let v = 50;
  const responseTimes: (number | null)[] = Array.from({ length: 96 }, (_, i) => {
    if (isDown && i >= 90) return null;
    v += (r() - 0.5) * 16;
    v = Math.max(28, Math.min(88, v));
    return v;
  });
  const r2 = rng(9);
  const checks: HealthStatus[] = Array.from({ length: 120 }, (_, i) => (isDown && i >= 114 ? 'down' : r2() < 0.04 ? 'slow' : 'up'));
  const L = (secondsAgo: number, level: LogLevel, message: string, extra: LogEntry['fields'] = {}) =>
    log(secondsAgo, level, service.name, message, 'node-01', { port: Number(service.port.slice(1)), ...extra }, service.project);
  // A healthy service logs healthy things; only a down one logs failed health checks.
  const recentLogs: LogEntry[] = isDown
    ? [
        L(4, 'error', `healthcheck failed: ECONNREFUSED 127.0.0.1${service.port}`, { consecutiveFailures: 6 }),
        L(34, 'error', `healthcheck failed: ECONNREFUSED 127.0.0.1${service.port}`, { consecutiveFailures: 5 }),
        L(190, 'error', 'unhandled rejection: Prisma P1001 cannot reach database', { code: 'P1001' }),
        L(194, 'warn', 'sqlite busy, retry 3/3 for invoice inv_5521', { attempt: 3 }),
        L(300, 'info', 'invoice inv_5520 paid, event invoice.paid published', { event: 'invoice.paid' }),
        L(331, 'warn', 'event loop lag 840 ms', { lagMs: 840 }),
      ]
    : [
        L(6, 'ok', `healthcheck passed in ${service.latencyMs ?? 0} ms`, { latencyMs: service.latencyMs ?? 0 }),
        L(36, 'ok', `healthcheck passed in ${service.latencyMs ?? 0} ms`, { latencyMs: service.latencyMs ?? 0 }),
        L(212, 'info', 'GET /health 200', { status: 200 }),
        ...(service.status === 'slow' ? [L(260, 'warn', `response time above threshold: ${service.latencyMs} ms (100 ms)`, { latencyMs: service.latencyMs ?? 0, thresholdMs: 100 })] : []),
        L(905, 'info', 'config reloaded', { source: 'env' }),
      ];
  return {
    service,
    target: `http://${service.project}${service.port}/health`,
    intervalSeconds: 30,
    downSince: isDown ? ago(16 * MIN) : null,
    failure: isDown ? `6 checks failed in a row · error: ECONNREFUSED 127.0.0.1${service.port} · alert sent to Discord and push` : null,
    kpis: { uptime24h: service.uptimePct, downtime24hSeconds: isDown ? 50 * MIN : 0, uptime30d: isDown ? 99.12 : 99.97, incidents30d: isDown ? 2 : 0, avgLatencyMs: 51, p95LatencyMs: 88, lastCheckAt: ago(4), lastCheckNote: isDown ? 'timed out after 5 s' : '200 OK', restarts24h: isDown ? 3 : 0 },
    responseTimes,
    checks,
    dependencies: [
      { nodes: [{ name: 'api-gateway', status: 'up', note: 'online' }, { name: service.name, status: service.status, note: service.status === 'down' ? 'down' : 'online' }, { name: 'finvault.db', status: isDown ? 'slow' : 'up', note: isDown ? 'unreachable' : 'online' }], broken: [isDown, false] },
      { nodes: [{ name: 'wallet-service', status: 'up', note: 'online' }, { name: 'rabbitmq', status: 'slow', note: '19 waiting' }, { name: 'invoice.events', status: isDown ? 'down' : 'up', note: isDown ? '0 consumers' : '1 consumer' }], broken: [false, isDown] },
    ],
    settings: [
      { label: 'Type', value: 'HTTP GET' }, { label: 'Interval', value: '30 s' }, { label: 'Timeout', value: '5 s' }, { label: 'Expected', value: '200 OK' },
      { label: 'Retries', value: '3 before alert' }, { label: 'Escalation', value: 'Discord → push' }, { label: 'Container', value: `${service.project}-${service.name}` },
    ],
    logs: recentLogs,
    timeline: isDown ? [
      { tone: 'error', title: 'Alert sent to Discord and push', when: ago(15 * MIN) },
      { tone: 'error', title: 'First failed check', when: ago(16 * MIN) },
      { tone: 'warn', title: 'Container restarted (3rd time)', when: ago(17 * MIN) },
      { tone: 'ok', title: 'Previous outage resolved (41 min)', when: ago(62 * DAY) },
      { tone: 'nx', title: 'Monitor created', when: ago(85 * DAY) },
    ] : [
      { tone: 'ok', title: 'All checks passing', when: ago(6) },
      { tone: 'info', title: 'Container deployed', when: ago(3 * DAY) },
      { tone: 'nx', title: 'Monitor created', when: ago(85 * DAY) },
    ],
  };
}

// ── Projects ───────────────────────────────────────────────────────────
export function nexusInfra(): NexusInfraData {
  const C = (name: string, image: string, node: string, state: ContainerRow['state'], cpuPct: number, memory: string, uptime: string, restarts: number): ContainerRow => ({ name, image, node, state, cpuPct, memory, uptime, restarts });
  return {
    kpis: { nodesOnline: 2, nodesTotal: 3, nodeNote: 'node-02 slow', containersRunning: 11, containersTotal: 12, containersNote: '1 stopped (backup-job)', cpuPct: 34, memoryUsedGb: 29, memoryTotalGb: 48, paymentsMonthEur: 312 },
    nodes,
    containers: [
      C('game-valheim-02', 'lloesche/valheim-server', 'node-02', 'running', 78, '3.1 GB', '6d 4h', 0),
      C('web-mc-04', 'itzg/minecraft-server', 'node-01', 'running', 54, '2.2 GB', '2d 9h', 0),
      C('web-mc-03', 'itzg/minecraft-server', 'node-01', 'running', 36, '1.9 GB', '9d 2h', 1),
      C('postgres-01', 'postgres:16', 'node-01', 'running', 33, '1.4 GB', '14d 6h', 0),
      C('nexus-gateway', 'nexusinfra/api-gateway', 'node-01', 'running', 14, '210 MB', '3d 1h', 0),
      C('nexus-orchestrator', 'nexusinfra/orchestrator', 'node-01', 'running', 17, '320 MB', '3d 1h', 0),
      C('nexus-control-room', 'nexusinfra/control-room', 'node-01', 'running', 9, '180 MB', '3d 1h', 0),
      C('nexus-agent', 'nexusinfra/node-agent', 'node-02', 'running', 12, '95 MB', '6d 4h', 4),
      C('rabbitmq', 'rabbitmq:3-management', 'node-03', 'running', 11, '320 MB', '14d 6h', 0),
      C('redis-cache', 'redis:7', 'node-03', 'running', 4, '64 MB', '14d 6h', 0),
      C('backup-job', 'nexusinfra/backup', 'node-01', 'stopped', 0, '0 MB', '-', 0),
    ],
    components: services.filter((s) => s.project === 'nexusinfra' && s.id !== 'nx-agent-node-01'),
    paymentsPerDay: walk(91, 30, 40, 40, { min: 8 }),
    payments: [
      { id: 'p1', server: 'srv_21 · web-mc-04', user: 'user u_18', when: ago(16 * MIN), amountEur: 6.5, paid: true },
      { id: 'p2', server: 'srv_24 · game-valheim-02', user: 'user u_07', when: ago(3 * HOUR), amountEur: 9, paid: true },
      { id: 'p3', server: 'srv_19 · web-mc-03', user: 'user u_11', when: ago(14 * HOUR), amountEur: 6.5, paid: true },
      { id: 'p4', server: 'srv_26 · postgres-01', user: 'user u_03', when: ago(21 * HOUR), amountEur: 4, paid: false },
    ],
  };
}

export function finVault(): FinVaultData {
  const fvService = (id: string, p95: string, rps: number, errorPct: number | null) => ({ service: byId(id)!, p95, rps, errorPct });
  const T = (secondsAgo: number, type: FinVaultData['transactions'][number]['type'], wallet: string, amount: string, incoming: boolean, state: FinVaultData['transactions'][number]['state']) => ({ id: `tx_${wallet}_${secondsAgo}`, time: ago(secondsAgo), type, wallet, amount, incoming, state });
  return {
    kpis: { topupsToday: 38, topupsTodayEur: 1240, topupsDelta: '+12% vs yesterday', activeWallets: 142, transfers: 211, transferSuccessPct: 98.6, openInvoices: 7, openInvoicesNote: 'invoice-service is down', fxConversions: 19, fxNote: '10 currencies · rate 4 min old' },
    funnel: [
      { label: 'Requested', count: 52, color: 'sky' },
      { label: 'Paid', count: 41, color: 'vi' },
      { label: 'Processed by FinVault', count: 38, color: 'fv' },
      { label: 'Credited at NexusInfra', count: 38, color: 'nx' },
    ],
    topupsPerHour: walk(95, 24, 45, 42, { min: 8 }),
    walletSplit: [{ label: 'Checking', pct: 64, color: 'fv' }, { label: 'Savings', pct: 24, color: 'vi' }, { label: 'Travel', pct: 12, color: 'sky' }],
    services: [
      fvService('fv-api-gateway', '38 ms', 14.2, 0.3), fvService('fv-account-service', '47 ms', 6.8, 0.1), fvService('fv-wallet-service', '55 ms', 9.1, 0.6),
      fvService('fv-invoice-service', 'timeout', 0, null), fvService('nx-billing-bridge', '71 ms', 1.2, 0),
    ],
    queues: [
      { name: 'account.events', ready: 3, threshold: 25, capacity: 50 },
      { name: 'wallet.events', ready: 42, threshold: 25, capacity: 50 },
      { name: 'invoice.events', ready: 19, threshold: 25, capacity: 50 },
    ],
    transactions: [
      T(260, 'top-up', 'w_3f9a', '+ €25.00', true, 'succeeded'), T(380, 'P2P', 'w_81c2', '- €12.50', false, 'succeeded'),
      T(680, 'SEPA', 'w_0d44', '- €240.00', false, 'pending'), T(920, 'top-up', 'w_a1e7', '+ €10.00', true, 'succeeded'),
      T(1340, 'FX', 'w_3f9a', '€50 → $54.10', false, 'succeeded'), T(1760, 'P2P', 'w_77be', '- €8.00', false, 'succeeded'),
      T(2540, 'top-up', 'w_c902', '+ €50.00', true, 'failed'),
    ],
    security: { failedLogins: 6, tokenReuse: 1, rateLimitHits: 14 },
  };
}

// ── Settings ───────────────────────────────────────────────────────────
const agents: Agent[] = [
  { id: 'ag_1', name: 'node-01', host: '192.168.1.20', tokenHint: '3f9a', version: 'v0.9.2', lastSeenSeconds: 4, status: 'up' },
  { id: 'ag_2', name: 'node-02', host: 'vm-laptop', tokenHint: 'b71c', version: 'v0.9.2', lastSeenSeconds: 12, status: 'slow' },
  { id: 'ag_3', name: 'node-03', host: 'vm-desktop', tokenHint: '09de', version: 'v0.9.1', lastSeenSeconds: 3, status: 'up' },
];

const channels: Channel[] = [
  { id: 'discord', name: 'Discord', description: 'Webhook to your own server', target: 'discord.com/api/webhooks/••••OKEN', configured: true, source: 'settings', enabled: true },
  { id: 'telegram', name: 'Telegram', description: 'Bot message to a chat, group or channel', target: 'Not set up yet', configured: false, source: null, enabled: false },
  { id: 'email', name: 'Email', description: 'SMTP through your home server', target: 'you@example.com', configured: true, source: 'settings', enabled: true },
  { id: 'push', name: 'Push (ntfy)', description: 'Instant notification on your phone', target: 'ntfy.sh/••••OPIC', configured: true, source: 'settings', enabled: true },
];

const routing: SettingsData['routing'] = {
  critical: { discord: true, telegram: true, email: true, push: true },
  warning: { discord: true, telegram: true, email: false, push: false },
  info: { discord: false, telegram: false, email: true, push: false },
};

const retention: SettingsData['retention'] = [
  { id: 'logs', label: 'Logs', usedBytes: 11 * GB, current: '14d', options: ['7d', '14d', '30d'] },
  { id: 'metrics', label: 'Metrics', usedBytes: 5 * GB, current: '90d', options: ['30d', '90d', '1y'] },
  { id: 'heartbeats', label: 'Heartbeats', usedBytes: 2.4 * GB, current: '180d', options: ['90d', '180d', '1y'] },
];

export function settings(): SettingsData {
  return {
    agents: agents.map((a) => ({ ...a })),
    agentSource: 'nexuswatch',
    serverUrl: 'https://watch.home.example',
    channels: channels.map((c) => ({ ...c })),
    routing: structuredClone(routing),
    retention: retention.map((r) => ({ ...r })),
    storage: { usedBytes: 18.4 * GB, totalBytes: 100 * GB },
  };
}

/** The sample stands in for a backend whose channels all work: nothing leaves the browser. */
export function testChannel(id: string): ChannelTestResult {
  if (!channels.some((c) => c.id === id)) throw new ApiError(404, `Channel ${id} not found`);
  return { ok: true, detail: 'Sample data — nothing was sent' };
}

/** Sets up a channel from the Settings form; 422 with the field's problem when it does not validate. */
export function configureChannel(id: string, input: Record<string, string>): void {
  const channel = channels.find((c) => c.id === id);
  if (!channel) throw new ApiError(404, `Channel ${id} not found`);
  const result = validateChannelConfig(channel.id, input ?? {});
  if (!result.ok) throw new ApiError(422, `${result.field}: ${result.error}`);
  Object.assign(channel, { configured: true, source: 'settings', target: maskChannelTarget(channel.id, result.target), enabled: true });
}

/** Forgets a channel set up in Settings. */
export function removeChannelConfig(id: string): void {
  const channel = channels.find((c) => c.id === id);
  if (!channel) throw new ApiError(404, `Channel ${id} not found`);
  Object.assign(channel, { configured: false, source: null, target: 'Not set up yet', enabled: false });
}

export function updateSettings(patch: Partial<Pick<SettingsData, 'channels' | 'routing' | 'retention'>>): void {
  if (patch.channels) channels.splice(0, channels.length, ...patch.channels);
  if (patch.routing) Object.assign(routing, patch.routing);
  if (patch.retention) retention.splice(0, retention.length, ...patch.retention);
}

// ── Business ───────────────────────────────────────────────────────────
// A week of top-ups between FinVault and NexusInfra. Most are healthy; a few break the Billing
// Bridge's promises on purpose, so the reconciliation view has something to show. The story is
// consistent with the rest of the sample: invoice-service went down 16 min ago, so the newest
// requests are still waiting, and a confirmation that dead-lettered explains the DLQ depth.
const TOPUP_TIMEOUT_MS = 30 * MIN * 1000;

/** A healthy top-up `requestedMinAgo` minutes ago that the customer paid `payMin` minutes later. */
function topUp(reference: string, accountId: string, amountEur: number, requestedMinAgo: number, patch: Partial<TopUpRecord> & { payMin?: number } = {}): TopUpRecord {
  const { payMin = 4, ...rest } = patch;
  const paidSecondsAgo = (requestedMinAgo - payMin) * MIN;
  return {
    reference, accountId, payer: null, amountEur,
    requestedAt: ago(requestedMinAgo * MIN),
    sent: true, status: 'confirmed', expiredAt: null,
    finvault: { outcome: 'confirmed', at: ago(paidSecondsAgo), amountEur, reason: null },
    credits: [{ at: ago(paidSecondsAgo - 1), amountEur }],
    ...rest,
  };
}

const unanswered = { status: 'pending', finvault: null, credits: [] } as const satisfies Partial<TopUpRecord>;

const topUps: TopUpRecord[] = [
  // In flight: invoice-service is down, so FinVault has not turned these into payment requests yet.
  topUp('tu_8k2m', 'acc_31f', 10, 4, { ...unanswered, credits: [], payer: 'r***@p***.nl' }),
  topUp('tu_8k1z', 'acc_07a', 25, 11, { ...unanswered, credits: [] }),
  // Stuck past TOPUP_TIMEOUT_MS with no answer at all — what a mismatched message key looks like.
  topUp('tu_8jx4', 'acc_52c', 20, 52, { ...unanswered, credits: [], status: 'not-confirmed', expiredAt: ago(22 * MIN), payer: 'm***@o***.com' }),
  topUp('tu_8jv0', 'acc_18d', 25, 95, { payMin: 6, payer: 'd***@g***.com' }),
  topUp('tu_8jq7', 'acc_11b', 50, 140, { payMin: 2 }),
  // Confirmed, never credited: the confirmation dead-lettered before the bridge could read it.
  topUp('tu_8jm2', 'acc_29e', 25, 190, { status: 'not-confirmed', expiredAt: ago(160 * MIN), payMin: 9, credits: [], payer: 'k***@g***.com' }),
  // Late confirmation (#298): paid 1.5 h after the top-up turned Not confirmed, and credited.
  topUp('tu_8jd9', 'acc_44f', 15, 300, { expiredAt: ago(270 * MIN), payMin: 120 }),
  topUp('tu_8j8c', 'acc_07a', 10, 420, { payMin: 3 }),
  topUp('tu_8j2r', 'acc_63a', 25, 610, { status: 'failed', finvault: { outcome: 'failed', at: ago(600 * MIN), amountEur: 25, reason: 'declined by customer' }, credits: [] }),
  topUp('tu_8hw5', 'acc_18d', 50, 890, { payMin: 11 }),
  // Not sent: the broker did not take payment.request, so it failed at once instead of waiting.
  topUp('tu_8hr1', 'acc_31f', 10, 1260, { sent: false, status: 'failed', finvault: null, credits: [] }),
  topUp('tu_8hk6', 'acc_75b', 100, 1500, { payMin: 5, payer: 's***@f***.be' }),
  // Amount mismatch: FinVault confirmed €5 for a €50 request; the bridge credited nothing, as it should.
  topUp('tu_8h9t', 'acc_52c', 50, 2100, { status: 'pending', finvault: { outcome: 'confirmed', at: ago(2094 * MIN), amountEur: 5, reason: null }, credits: [] }),
  topUp('tu_8h3e', 'acc_11b', 25, 2800, { payMin: 2 }),
  // Credited twice: two deliveries of one confirmation a second apart — the race #298 closed.
  topUp('tu_8gx8', 'acc_29e', 20, 3400, { payMin: 3, credits: [{ at: ago(3397 * MIN - 1), amountEur: 20 }, { at: ago(3397 * MIN - 2), amountEur: 20 }] }),
  topUp('tu_8gp3', 'acc_44f', 25, 4300, { payMin: 7 }),
  topUp('tu_8gf1', 'acc_63a', 10, 5200, { status: 'failed', finvault: { outcome: 'failed', at: ago(5195 * MIN), amountEur: 10, reason: 'insufficient funds' }, credits: [] }),
  topUp('tu_8g70', 'acc_75b', 50, 6100, { payMin: 4 }),
  topUp('tu_8fz2', 'acc_18d', 25, 7400, { payMin: 1 }),
  topUp('tu_8fq9', 'acc_07a', 25, 8600, { payMin: 6 }),
  topUp('tu_8fh4', 'acc_86c', 15, 9300, { payMin: 3, payer: 'l***@h***.com' }),
];

function standing(accountId: string, planId: string, balanceEur: number, availableEur: number, hoursLeft: number | null, runningServers: number, lowCreditWarnedAt: string | null = null): AccountStanding {
  return { accountId, planId, balanceEur, availableEur, canRun: availableEur > 0, hoursLeft, runningServers, lowCreditWarnedAt };
}

function plan(planId: string, name: string, color: PlanRevenue['color'], accounts: number, seed: number, base: number): PlanRevenue {
  const perDay = walk(seed, 30, base, base * 0.5, { min: base * 0.4, max: base * 2 }).map((v) => Math.round(v * 100) / 100);
  return { planId, name, color, accounts, perDay, revenueEur: Math.round(perDay.reduce((s, v) => s + v, 0) * 100) / 100 };
}

const CREDIT_OUT = 'credit exhausted — €0.00 left at settlement';

export function business(): BusinessData {
  return {
    topUpTimeoutMs: TOPUP_TIMEOUT_MS,
    lowCreditHours: 24,
    topUps,
    accounts: [
      standing('acc_63a', 'starter', 0, 0, null, 0),
      standing('acc_52c', 'standard', 1.2, 0.35, 6.4, 2, ago(3 * HOUR)),
      standing('acc_31f', 'starter', 3.1, 1.9, 19, 1, ago(9 * HOUR)),
      standing('acc_29e', 'standard', 44, 38.6, 210, 2),
      standing('acc_07a', 'starter', 22.4, 20.1, 402, 1),
      standing('acc_18d', 'pro', 96.5, 88.2, 131, 4),
      standing('acc_11b', 'pro', 61, 57.3, 95, 3),
      standing('acc_44f', 'standard', 18.7, 17.9, 160, 1),
      standing('acc_75b', 'pro', 140, 140, null, 0),
      standing('acc_86c', 'starter', 15, 15, null, 0),
    ],
    suspended: [
      { deploymentId: 'dep_4c91', accountId: 'acc_63a', suspendedAt: ago(6 * HOUR + 12 * MIN), reason: CREDIT_OUT },
      { deploymentId: 'dep_4c7e', accountId: 'acc_63a', suspendedAt: ago(6 * HOUR + 12 * MIN), reason: CREDIT_OUT },
      { deploymentId: 'dep_3b20', accountId: 'acc_63a', suspendedAt: ago(DAY + 4 * HOUR), reason: 'short balance at the monthly cycle' },
    ],
    revenueByPlan: [
      plan('starter', 'Starter', 'sky', 4, 301, 2.1),
      plan('standard', 'Standard', 'vi', 3, 302, 4.6),
      plan('pro', 'Pro', 'nx', 3, 303, 7.9),
    ],
    bus: {
      exchange: 'finvault.events',
      throughputPerMin: walk(311, 60, 42, 14, { min: 12, max: 90 }).map(Math.round),
      dlq: { name: 'finvault.events.dlq', depth: 3, error: null, checkedAt: ago(20) },
      outboxes: [
        { service: 'billing-bridge', pending: 0, dropped: 0 },
        { service: 'orchestrator', pending: 0, dropped: 0 },
        { service: 'node-agent · node-01', pending: 0, dropped: 0 },
        { service: 'node-agent · node-02', pending: 4, dropped: 0 },
        { service: 'node-agent · node-03', pending: null, dropped: null },
      ],
      queues: [
        { name: 'billing-bridge.payments', bindings: ['bank.payment.*', 'events.payment.*'], consumers: 1, ready: 0 },
        { name: 'invoice-service.payment-requests', bindings: ['bank.payment.request'], consumers: 0, ready: 2 },
        { name: 'invoice-service.statements', bindings: ['invoice.generate'], consumers: 0, ready: 0 },
        { name: 'orchestrator.billing', bindings: ['billing.server.suspend', 'billing.credit.low'], consumers: 1, ready: 0 },
        { name: 'control-room.heartbeats', bindings: ['monitoring.heartbeat.#'], consumers: null, ready: null },
      ],
    },
  };
}
