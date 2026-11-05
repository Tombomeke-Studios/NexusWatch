/**
 * The NexusWatch API contract as the dashboard consumes it.
 * Mock data (api/mock) and the real backend must both produce exactly these shapes.
 * Every timestamp is a UTC ISO-8601 string; every series is ordered oldest → newest.
 */

export type ProjectId = 'nexusinfra' | 'finvault';
export type HealthStatus = 'up' | 'slow' | 'down';
export type LogLevel = 'error' | 'warn' | 'info' | 'ok';
export type Severity = 'critical' | 'warning' | 'info';
export type TimeRange = '1h' | '24h' | '7d' | '30d';
/** Chart palette keys — map to `--c-<key>` tokens. */
export type ChartColor = 'nx' | 'fv' | 'vi' | 'sky' | 'down' | 'warn' | 'ok';

export interface Series {
  name: string;
  color: ChartColor;
  values: number[];
}

// ── Shell ──────────────────────────────────────────────────────────────
export interface HostInfo {
  name: string;
  address: string;
  uptimeSeconds: number;
  nodesConnected: number;
  online: boolean;
}

export interface NavCounts {
  openAlerts: number;
  services: Record<ProjectId, number>;
}

// ── Services & heartbeats ──────────────────────────────────────────────
export interface ServiceSummary {
  id: string;
  name: string;
  project: ProjectId;
  port: string;
  status: HealthStatus;
  /** null = the last check got no answer. */
  latencyMs: number | null;
  uptimePct: number;
  /** Most recent checks, oldest first. */
  beats: HealthStatus[];
}

export interface Gauge {
  label: string;
  pct: number;
  text: string;
}

export interface NodeSummary {
  id: string;
  name: string;
  status: HealthStatus;
  host: string;
  lastBeatSeconds: number;
  containers: number;
  agentVersion: string;
  gauges: Gauge[];
}

export interface Monitor {
  id: string;
  serviceId: string;
  name: string;
  project: ProjectId;
  target: string;
  uptimePct: number;
  status: HealthStatus;
  avgLatencyMs: number;
  nowLatencyMs: number | null;
  /** One status per day, oldest first (60 entries). */
  days: HealthStatus[];
}

export interface Incident {
  id: string;
  open: boolean;
  severity: Severity;
  title: string;
  note: string;
  startedAt: string;
  durationSeconds: number;
}

export interface HeartbeatsData {
  nodes: NodeSummary[];
  monitors: Monitor[];
  incidents: Incident[];
}

// ── Logs ───────────────────────────────────────────────────────────────
export interface LogEntry {
  id: string;
  time: string;
  level: LogLevel;
  service: string;
  /** Set when the line belongs to a monitored service (links to its detail page). */
  serviceId?: string;
  project: ProjectId;
  node: string;
  message: string;
  /** Raw structured document as stored. */
  fields: Record<string, string | number | boolean>;
}

export interface Facet {
  value: string;
  count: number;
}

export interface LogQuery {
  query: string;
  range: TimeRange;
  levels: LogLevel[];
  project?: ProjectId;
}

export interface LogsData {
  total: number;
  /** Histogram buckets, oldest first. */
  histogram: { error: number; warn: number }[];
  facets: { level: Facet[]; service: Facet[]; node: Facet[] };
  entries: LogEntry[];
}

// ── Overview ───────────────────────────────────────────────────────────
export interface OverviewData {
  kpis: {
    servicesUp: number;
    servicesTotal: number;
    servicesSlow: number;
    servicesDown: number;
    p95Ms: number;
    p95Trend: number[];
    openAlerts: number;
    openAlertsSummary: string;
    topupsToday: number;
    topupsTrend: number[];
    paymentsMonthEur: number;
    paymentsTrend: number[];
  };
  services: ServiceSummary[];
  events: LogEntry[];
  cpuByNode: Series[];
  requests: { rps: number[]; errors5xx: number[] };
  topupsPerHour: number[];
  paymentsPerDay: number[];
}

// ── Metrics ────────────────────────────────────────────────────────────
export type MetricId = 'cpu' | 'memory' | 'disk' | 'network' | 'queues';

export interface MetricData {
  id: MetricId;
  label: string;
  title: string;
  description: string;
  unit: string;
  /** Upper bound of the y axis. */
  max: number;
  query: string;
  series: Series[];
}

export interface MetricSummary {
  title: string;
  value: string;
  unit: string;
  delta: string;
  tone: 'ok' | 'warn' | 'down' | 'info' | 'mute';
  color: ChartColor;
  trend: number[];
}

export interface ContainerUsage {
  name: string;
  project: ProjectId;
  node: string;
  cpuPct: number;
  memoryBytes: number;
}

export interface MetricsOverview {
  summaries: MetricSummary[];
  topContainers: ContainerUsage[];
}

// ── Alerts ─────────────────────────────────────────────────────────────
/** What a rule measures. Each maps to a metric key (see lib/rules.ts `METRICS`). */
export type RuleMetric = 'heartbeat' | 'latency' | 'cpu' | 'memory' | 'disk' | 'queue_depth' | 'error_rate' | 'topups';
export type Comparator = '>' | '>=' | '<' | '<=' | '==' | '!=';

export interface RuleCondition {
  metric: RuleMetric;
  comparator: Comparator;
  threshold: number;
  /** How long the condition must hold before the rule fires; 0 = on the first breaching sample. */
  forSeconds: number;
}

export interface AlertRule {
  id: string;
  name: string;
  project: ProjectId;
  condition: RuleCondition;
  severity: Severity;
  /** Channels notified the moment the rule fires. */
  channels: ChannelId[];
  /** Optional escalation while the alert stays unacknowledged. */
  escalationPolicyId: string | null;
  /** Free-text link to the runbook; empty when there is none. */
  runbookUrl: string;
  enabled: boolean;
}

/** Body of `POST /alert-rules` and `PUT /alert-rules/:id`. */
export type AlertRuleInput = Omit<AlertRule, 'id'>;

export type AlertNoteKind = 'acknowledged' | 'resolved' | 'note';

export interface AlertNote {
  id: string;
  kind: AlertNoteKind;
  text: string;
  at: string;
}

export interface ActiveAlert {
  id: string;
  ruleId: string;
  severity: Severity;
  project: ProjectId;
  serviceId: string;
  title: string;
  description: string;
  rule: string;
  startedAt: string;
  durationSeconds: number;
  value: string;
  trend: number[];
  acknowledged: boolean;
  acknowledgedAt: string | null;
  /** Set while a silence (on this alert or its rule) mutes it. */
  silenceId: string | null;
  /** Set while a maintenance window covers it; notifications and escalation are suppressed. */
  maintenanceId: string | null;
  notes: AlertNote[];
}

export interface AlertHistoryItem {
  id: string;
  /** The active alert this entry belongs to, while it exists. */
  alertId?: string;
  open: boolean;
  title: string;
  project: ProjectId;
  severity: Severity;
  startedAt: string;
  durationSeconds: number;
  notes: AlertNote[];
}

export type SilenceDuration = '15m' | '1h' | '4h' | 'resolved';

export interface Silence {
  id: string;
  kind: 'alert' | 'rule';
  targetId: string;
  /** Human name of what is muted (alert title or rule name), for lists. */
  label: string;
  reason: string;
  createdAt: string;
  /** null = until the alert (or every alert of the rule) resolves. */
  endsAt: string | null;
}

/** Body of `POST /silences`. */
export interface SilenceInput {
  kind: Silence['kind'];
  targetId: string;
  duration: SilenceDuration;
  reason: string;
}

export interface MaintenanceWindow {
  id: string;
  title: string;
  project: ProjectId;
  /** null = the whole project. */
  serviceId: string | null;
  startsAt: string;
  durationMinutes: number;
  recurrence: 'none' | 'weekly';
}

export type MaintenanceInput = Omit<MaintenanceWindow, 'id'>;

export interface EscalationStep {
  channel: ChannelId;
  /** Minutes after the alert fired; steps after the first only run while it is unacknowledged. */
  afterMinutes: number;
}

export interface EscalationPolicy {
  id: string;
  name: string;
  steps: EscalationStep[];
}

export type EscalationPolicyInput = Omit<EscalationPolicy, 'id'>;

/** A service a maintenance window can target. */
export interface ServiceRef {
  id: string;
  name: string;
  project: ProjectId;
}

export type TargetState = 'firing' | 'pending' | 'ok' | 'no_data';

/** Result of `POST /alert-rules/test`: the rule evaluated against the current data. */
export interface RuleTestResult {
  evaluatedAt: string;
  fires: boolean;
  targets: { target: string; serviceId?: string; state: TargetState; value: number | null; heldSeconds: number }[];
}

export interface AlertsData {
  summary: { critical: number; warning: number; muted: number; inMaintenance: number; resolved24h: number; resolvedAuto24h: number; mttrMinutes: number };
  active: ActiveAlert[];
  rules: AlertRule[];
  history: AlertHistoryItem[];
  silences: Silence[];
  maintenance: MaintenanceWindow[];
  policies: EscalationPolicy[];
  services: ServiceRef[];
}

// ── Service detail ─────────────────────────────────────────────────────
export interface DependencyNode {
  name: string;
  status: HealthStatus;
  note: string;
}

export interface ServiceDetail {
  service: ServiceSummary;
  target: string;
  intervalSeconds: number;
  downSince: string | null;
  failure: string | null;
  kpis: { uptime24h: number; downtime24hSeconds: number; uptime30d: number; incidents30d: number; avgLatencyMs: number; p95LatencyMs: number; lastCheckAt: string; lastCheckNote: string; restarts24h: number };
  /** Response time per check over 24h; null = no answer. */
  responseTimes: (number | null)[];
  checks: HealthStatus[];
  /** Each chain is a path of edges: a → b → c; `broken[i]` marks the edge after node i. */
  dependencies: { nodes: DependencyNode[]; broken: boolean[] }[];
  settings: { label: string; value: string }[];
  logs: LogEntry[];
  timeline: { title: string; when: string; tone: LogLevel | 'nx' }[];
}

// ── Projects ───────────────────────────────────────────────────────────
export interface ContainerRow {
  name: string;
  image: string;
  node: string;
  state: 'running' | 'stopped' | 'restarting';
  cpuPct: number;
  memory: string;
  uptime: string;
  restarts: number;
}

export interface Payment {
  id: string;
  server: string;
  user: string;
  when: string;
  amountEur: number;
  paid: boolean;
}

export interface NexusInfraData {
  kpis: { nodesOnline: number; nodesTotal: number; nodeNote: string; containersRunning: number; containersTotal: number; containersNote: string; cpuPct: number; memoryUsedGb: number; memoryTotalGb: number; paymentsMonthEur: number };
  nodes: NodeSummary[];
  containers: ContainerRow[];
  components: ServiceSummary[];
  paymentsPerDay: number[];
  payments: Payment[];
}

export interface FinVaultService {
  service: ServiceSummary;
  p95: string;
  rps: number;
  errorPct: number | null;
}

export interface Transaction {
  id: string;
  time: string;
  type: 'top-up' | 'P2P' | 'SEPA' | 'FX';
  wallet: string;
  amount: string;
  incoming: boolean;
  state: 'succeeded' | 'pending' | 'failed';
}

export interface FinVaultData {
  kpis: { topupsToday: number; topupsTodayEur: number; topupsDelta: string; activeWallets: number; transfers: number; transferSuccessPct: number; openInvoices: number; openInvoicesNote: string; fxConversions: number; fxNote: string };
  funnel: { label: string; count: number; color: ChartColor }[];
  topupsPerHour: number[];
  walletSplit: { label: string; pct: number; color: ChartColor }[];
  services: FinVaultService[];
  queues: { name: string; ready: number; threshold: number; capacity: number }[];
  transactions: Transaction[];
  security: { failedLogins: number; tokenReuse: number; rateLimitHits: number };
}

// ── Settings ───────────────────────────────────────────────────────────
export interface Agent {
  id: string;
  name: string;
  host: string;
  tokenHint: string;
  version: string;
  lastSeenSeconds: number;
  status: HealthStatus;
}

export type ChannelId = 'discord' | 'telegram' | 'email' | 'push';

export interface Channel {
  id: ChannelId;
  name: string;
  description: string;
  target: string;
  enabled: boolean;
}

export interface SettingsData {
  agents: Agent[];
  serverUrl: string;
  channels: Channel[];
  routing: Record<Severity, Record<ChannelId, boolean>>;
  retention: { id: 'logs' | 'metrics' | 'heartbeats'; label: string; usedBytes: number; current: string; options: string[] }[];
  storage: { usedBytes: number; totalBytes: number };
}
