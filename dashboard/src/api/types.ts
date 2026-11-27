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
    /** null = not measured (the collector has no event bus to read top-ups from). */
    topupsToday: number | null;
    topupsTrend: number[];
    /** null = not measured, like `topupsToday`. */
    paymentsMonthEur: number | null;
    paymentsTrend: number[];
  };
  services: ServiceSummary[];
  events: LogEntry[];
  cpuByNode: Series[];
  requests: { rps: number[]; errors5xx: number[] };
  topupsPerHour: number[];
  paymentsPerDay: number[];
  /** How often the health checks run (the shortest interval); null when nothing is checked. */
  checkIntervalSeconds: number | null;
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
  /** null = not measured (no request-rate source for this service). */
  rps: number | null;
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
  /** null = no source measures it (shown as unknown, never 0). */
  kpis: { topupsToday: number; topupsTodayEur: number; topupsDelta: string; activeWallets: number; transfers: number; transferSuccessPct: number | null; openInvoices: number | null; openInvoicesNote: string; fxConversions: number | null; fxNote: string };
  funnel: { label: string; count: number; color: ChartColor }[];
  topupsPerHour: number[];
  walletSplit: { label: string; pct: number; color: ChartColor }[];
  services: FinVaultService[];
  queues: { name: string; ready: number; threshold: number; capacity: number }[];
  transactions: Transaction[];
  /** null = no source (FinVault does not publish these). */
  security: { failedLogins: number; tokenReuse: number; rateLimitHits: number } | null;
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
  /** Where it sends to, masked: the real target is a secret that lives in the backend's configuration. */
  target: string;
  /** False while the backend has no target for it; then `target` says how to set one up. */
  configured: boolean;
  /**
   * Where the target comes from: `env` (the collector's NW_* variables — they win and cannot be changed
   * here), `settings` (entered on the Settings page), null while not set up.
   */
  source: ChannelSource | null;
  enabled: boolean;
}

export type ChannelSource = 'env' | 'settings';

/**
 * Body of `PUT /settings/channels/:id`: the fields `CHANNEL_FIELDS` (lib/channels.ts) lists for that
 * channel. Write-only — the API never returns it, only the masked `Channel.target`.
 */
export type ChannelConfig = Record<string, string>;

/** Answer of `POST /services/:id/check` ("Test now"): one health check, run right away and stored. */
export interface ServiceCheckResult {
  at: string;
  status: HealthStatus;
  /** null = no answer. */
  latencyMs: number | null;
  note: string;
}

/** Answer of `POST /settings/channels/:id/test`. A failed delivery is a result, not an HTTP error. */
export interface ChannelTestResult {
  ok: boolean;
  /** "Delivered", or why not — never contains the target. */
  detail: string;
}

export interface SettingsData {
  /**
   * Who the agents are: `nexuswatch` = NexusWatch's own agent (tokens, install snippet); `nexusinfra` =
   * NexusInfra's node agents heard on the bus — nothing to install or rotate here.
   */
  agentSource: 'nexuswatch' | 'nexusinfra';
  agents: Agent[];
  serverUrl: string;
  channels: Channel[];
  routing: Record<Severity, Record<ChannelId, boolean>>;
  retention: { id: 'logs' | 'metrics' | 'heartbeats'; label: string; usedBytes: number; current: string; options: string[] }[];
  storage: { usedBytes: number; totalBytes: number };
}

// ── Collector ──────────────────────────────────────────────────────────
/** `GET /health` of the collector itself (not used by the pages; for ops and Docker). */
export interface CollectorHealth {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  /** Which parts of the API are fed by a configured source; the rest is sample data. */
  live: Record<'services' | 'nodes' | 'nodeMetrics' | 'requests' | 'queues' | 'logs', boolean>;
  /** One entry per periodic source job (health target, Control Room poll, scrape, bus). */
  sources: { name: string; intervalMs: number; lastRunAt: string | null; lastOkAt: string | null; lastError: string | null }[];
}

// ── Reliability: SLOs ──────────────────────────────────────────────────
/** Burn-rate windows. 1h/6h/24h are the long windows; 5m/30m/2h confirm a burn is still happening. */
export type BurnWindow = '5m' | '30m' | '1h' | '2h' | '6h' | '24h';

/**
 * Health checks in a period. `good` = answered (up or slow), `bad` = failed,
 * `unknown` = no data (agent offline, collector gap) — excluded from every SLO calculation.
 */
export interface CheckTally {
  good: number;
  bad: number;
  unknown: number;
}

/** An availability objective for one service. The dashboard derives budget and burn from the tallies. */
export interface Slo {
  id: string;
  serviceId: string;
  name: string;
  project: ProjectId;
  /** What counts as good, in words. */
  objective: string;
  /** e.g. 99.9 */
  targetPct: number;
  /** Rolling window, e.g. 30. */
  windowDays: number;
  /** All checks in the rolling window. */
  window: CheckTally;
  /** One tally per day of the window, oldest first (`windowDays` entries). */
  daily: CheckTally[];
  burnWindows: Record<BurnWindow, CheckTally>;
}

export interface SloData {
  slos: Slo[];
}

// ── Reliability: incidents ─────────────────────────────────────────────
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export interface IncidentUpdate {
  id: string;
  at: string;
  status: IncidentStatus;
  message: string;
  author: string;
  /** Shown on the public status page. Internal notes (hosts, ports, stack traces) stay false. */
  public: boolean;
}

export interface ActionItem {
  id: string;
  title: string;
  owner: string;
  done: boolean;
}

export interface Postmortem {
  summary: string;
  rootCause: string;
  actionItems: ActionItem[];
}

export interface IncidentDetail {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  /** One line for lists (Heartbeats). */
  summary: string;
  affected: { serviceId: string; name: string; project: ProjectId }[];
  startedAt: string;
  resolvedAt: string | null;
  /** Until now while open; until `resolvedAt` once resolved. */
  durationSeconds: number;
  /** Shown on the public status page (with `publicTitle`, and only its public updates). */
  public: boolean;
  publicTitle: string;
  /** Newest first. */
  updates: IncidentUpdate[];
  postmortem: Postmortem | null;
}

export interface IncidentsData {
  /** Open incidents first, then newest first. */
  incidents: IncidentDetail[];
  summary: { open: number; last30d: number; mttrMinutes: number | null };
}

export interface NewIncident {
  title: string;
  severity: Severity;
  serviceIds: string[];
  message: string;
  public: boolean;
  publicTitle?: string;
}

export interface NewIncidentUpdate {
  status: Exclude<IncidentStatus, 'resolved'>;
  message: string;
  public: boolean;
}

export interface ResolveIncident {
  message: string;
  public: boolean;
  postmortem: Postmortem | null;
}

// ── Public status page ─────────────────────────────────────────────────
/**
 * Everything on /status is public. These types are deliberately separate from the internal ones and
 * carry no hosts, addresses, ports, targets, node names or internal ids — `data.test.ts` enforces it.
 */
export type PublicStatus = 'operational' | 'degraded' | 'partial-outage' | 'major-outage' | 'maintenance';

export interface StatusComponent {
  /** Public slug, not an internal service id. */
  slug: string;
  name: string;
  status: PublicStatus;
  /** Over the known days; null without any. */
  uptimePct: number | null;
  /** 90 days, oldest first; null = no data that day. */
  days: (HealthStatus | null)[];
}

export interface StatusGroup {
  project: ProjectId;
  name: string;
  components: StatusComponent[];
}

export interface PublicIncident {
  slug: string;
  title: string;
  status: IncidentStatus;
  impact: Severity;
  startedAt: string;
  resolvedAt: string | null;
  /** Component names. */
  components: string[];
  /** Public updates only, newest first. */
  updates: { at: string; status: IncidentStatus; message: string }[];
}

export interface Maintenance {
  slug: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  components: string[];
}

export interface StatusPageData {
  overall: PublicStatus;
  updatedAt: string;
  groups: StatusGroup[];
  /** Unresolved public incidents. */
  active: PublicIncident[];
  /** Resolved in the last 14 days. */
  recent: PublicIncident[];
  maintenance: Maintenance[];
}

// ── Business (FinVault → NexusInfra money flow) ────────────────────────
/** The Billing Bridge's own status for a top-up (NexusInfra #298, #351). */
export type TopUpLedgerStatus = 'pending' | 'confirmed' | 'failed' | 'not-confirmed';

/**
 * One top-up as both sides recorded it. NexusWatch only observes: the dashboard reconciles
 * these records itself (lib/reconcile.ts), so the backend reports facts, not verdicts.
 */
export interface TopUpRecord {
  /** The reference NexusInfra issued with `payment.request`; FinVault answers with it. */
  reference: string;
  accountId: string;
  /** Masked by the backend (`t***@e***.com`) — never a full address. */
  payer: string | null;
  amountEur: number;
  requestedAt: string;
  /** Whether the broker took `payment.request`. Not sent = failed at once, never pending. */
  sent: boolean;
  /** The bridge's own status; null = not observed (the collector sees the bus, not the bridge's ledger). */
  status: TopUpLedgerStatus | null;
  /** When the bridge turned it *Not confirmed* (`TOPUP_TIMEOUT_MS`); null if it never did. */
  expiredAt: string | null;
  /** FinVault's answer as seen on the bus (`events.payment.*` / `bank.payment.*`); null = none yet. */
  finvault: { outcome: 'confirmed' | 'failed'; at: string; amountEur: number; reason: string | null } | null;
  /**
   * Credit-ledger entries carrying this reference, oldest first. Exactly one is the healthy case.
   * null = not observed: the Billing Bridge publishes no credit event, so a backend that only reads
   * the bus cannot know. Never sent as [] in that case — an empty list claims "not credited".
   */
  credits: { at: string; amountEur: number }[] | null;
}

/** An account's standing at the Billing Bridge (#365, #379). Ids only. */
export interface AccountStanding {
  accountId: string;
  planId: string;
  balanceEur: number;
  /** Balance less usage not yet charged. */
  availableEur: number;
  canRun: boolean;
  /** How long what is left lasts at the running servers' rate; null = nothing running (no estimate). */
  hoursLeft: number | null;
  runningServers: number;
  /** When `billing.credit.low` was last published for this dip; null = not warned. */
  lowCreditWarnedAt: string | null;
}

/** A server stopped by `billing.server.suspend` (#380). */
export interface SuspendedServer {
  deploymentId: string;
  accountId: string;
  suspendedAt: string;
  reason: string;
}

export interface PlanRevenue {
  planId: string;
  name: string;
  color: ChartColor;
  accounts: number;
  revenueEur: number;
  /** Usage charged at this plan's rate per day, last 30 days, oldest first. */
  perDay: number[];
}

export interface BusQueue {
  name: string;
  /** Routing keys bound to it on `finvault.events`. */
  bindings: string[];
  /** null = the broker could not be asked. */
  consumers: number | null;
  ready: number | null;
}

export interface OutboxState {
  /** The publisher holding the outbox (#167). */
  service: string;
  /** null = the service did not report. */
  pending: number | null;
  dropped: number | null;
}

export interface BusHealth {
  exchange: string;
  /** Messages published on the exchange per minute, last 60 minutes, oldest first. */
  throughputPerMin: number[];
  /** Dead-letter queue (#243): depth null = unknown, never 0. */
  dlq: { name: string; depth: number | null; error: string | null; checkedAt: string };
  outboxes: OutboxState[];
  queues: BusQueue[];
}

export interface BusinessData {
  /** NexusInfra's `TOPUP_TIMEOUT_MS`, so the dashboard judges with the bridge's own clock. */
  topUpTimeoutMs: number;
  /** NexusInfra's `LOW_CREDIT_HOURS`. */
  lowCreditHours: number;
  /** Top-ups requested in the last 7 days, newest first. */
  topUps: TopUpRecord[];
  accounts: AccountStanding[];
  suspended: SuspendedServer[];
  revenueByPlan: PlanRevenue[];
  bus: BusHealth;
}
