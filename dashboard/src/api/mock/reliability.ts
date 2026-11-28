/**
 * Sample data for SLOs, incidents and the public status page. Served while VITE_USE_MOCKS=true.
 * Seeded so it is stable; timestamps are relative to "now"; incidents are in-memory and mutable.
 *
 * `services` from ./data is only read inside functions: data.ts imports this module back
 * (Heartbeats lists the incidents kept here), so nothing at module level may touch it.
 */
import { overallStatus, toPublicStatus, worstStatus } from '@/lib/publicStatus';
import { rng } from '@/lib/series';
import type {
  BurnWindow, CheckTally, HealthStatus, Incident, IncidentDetail, IncidentStatus, IncidentUpdate, IncidentsData,
  Maintenance, NewIncident, NewIncidentUpdate, ProjectId, PublicIncident, PublicStatus, ResolveIncident, Slo, SloData, StatusComponent,
  StatusPageData,
} from '../types';
import { ApiError } from '../client';
import { services } from './data';

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;
const at = (secondsFromNow: number): string => new Date(Date.now() + secondsFromNow * 1000).toISOString();
const ago = (seconds: number) => at(-seconds);

// ── SLOs ───────────────────────────────────────────────────────────────
/** Every service is checked every 30 s. */
const CHECKS_PER_MINUTE = 2;
const CHECKS_PER_DAY = CHECKS_PER_MINUTE * 24 * 60;
const WINDOW_MINUTES: Record<BurnWindow, number> = { '5m': 5, '30m': 30, '1h': 60, '2h': 120, '6h': 360, '24h': 1440 };

interface SloSpec {
  serviceId: string;
  targetPct: number;
  /** [days ago, failed checks that day] */
  outages?: [number, number][];
  /** Failed checks inside each burn window (must not shrink as the window grows). */
  recent?: Partial<Record<BurnWindow, number>>;
  /** Share of checks without data. */
  unknownRate?: number;
  /** [days ago, checks without data that day] — collector or agent gaps. */
  gaps?: [number, number][];
}

const SLO_SPECS: SloSpec[] = [
  { serviceId: 'nx-api-gateway', targetPct: 99.9 },
  { serviceId: 'nx-orchestrator', targetPct: 99.5, outages: [[9, 20]] },
  { serviceId: 'nx-control-room', targetPct: 99.5 },
  { serviceId: 'nx-agent-node-01', targetPct: 99.5 },
  { serviceId: 'nx-agent-node-02', targetPct: 99.5, outages: [[27, 16]], unknownRate: 0.04, gaps: [[1, 900], [0, 300]] },
  { serviceId: 'nx-rabbitmq', targetPct: 99.9 },
  { serviceId: 'nx-billing-bridge', targetPct: 99.5, outages: [[4, 40]] },
  { serviceId: 'fv-api-gateway', targetPct: 99.9, outages: [[2, 6]] },
  { serviceId: 'fv-account-service', targetPct: 99.9 },
  { serviceId: 'fv-wallet-service', targetPct: 99.9, outages: [[0, 10]], recent: { '2h': 1, '6h': 4, '24h': 10 } },
  {
    serviceId: 'fv-invoice-service', targetPct: 99.9, outages: [[11, 120], [0, 32]],
    recent: { '5m': 10, '30m': 32, '1h': 32, '2h': 32, '6h': 32, '24h': 32 },
  },
];

const tally = (total: number, bad: number, unknown: number): CheckTally => ({ good: total - bad - unknown, bad, unknown });

function buildSlo(spec: SloSpec, seed: number): Slo {
  const service = services.find((s) => s.id === spec.serviceId)!;
  const windowDays = 30;
  const r = rng(seed);
  const unknownRate = spec.unknownRate ?? 0.002;
  const daily = Array.from({ length: windowDays }, (_, i) => {
    const daysAgo = windowDays - 1 - i;
    const bad = (spec.outages?.find(([d]) => d === daysAgo)?.[1] ?? 0) + (r() < 0.1 ? 1 : 0);
    const gap = spec.gaps?.find(([d]) => d === daysAgo)?.[1] ?? 0;
    const unknown = gap + Math.round(CHECKS_PER_DAY * unknownRate * (0.5 + r()));
    return tally(CHECKS_PER_DAY, bad, unknown);
  });
  const burnWindows = Object.fromEntries(
    (Object.keys(WINDOW_MINUTES) as BurnWindow[]).map((w) => {
      const n = WINDOW_MINUTES[w] * CHECKS_PER_MINUTE;
      return [w, tally(n, spec.recent?.[w] ?? 0, Math.round(n * unknownRate))];
    }),
  ) as Record<BurnWindow, CheckTally>;
  const window = daily.reduce((a, t) => ({ good: a.good + t.good, bad: a.bad + t.bad, unknown: a.unknown + t.unknown }), { good: 0, bad: 0, unknown: 0 });
  return {
    id: `slo_${service.id}`,
    serviceId: service.id,
    name: service.name,
    project: service.project,
    objective: 'Health check answers within 5 s',
    targetPct: spec.targetPct,
    checkIntervalSeconds: 60 / CHECKS_PER_MINUTE,
    windowDays,
    window,
    daily,
    burnWindows,
  };
}

export function slos(): SloData {
  return { slos: SLO_SPECS.map((spec, i) => buildSlo(spec, 300 + i)) };
}

// ── Incidents ──────────────────────────────────────────────────────────
export interface StoredIncident extends Omit<IncidentDetail, 'affected' | 'durationSeconds'> {
  serviceIds: string[];
}

let updateSeq = 0;
const upd = (secondsAgo: number, status: IncidentStatus, message: string, isPublic: boolean, author = 'tom'): IncidentUpdate => ({
  id: `upd_${++updateSeq}`, at: ago(secondsAgo), status, message, author, public: isPublic,
});

const incidentStore: StoredIncident[] = [
  {
    id: 'inc_4', title: 'invoice-service is not responding', severity: 'critical', status: 'identified',
    summary: 'Health check returns ECONNREFUSED on :8003. Queue invoice.events is growing.',
    serviceIds: ['fv-invoice-service'], startedAt: ago(16 * MIN), resolvedAt: null,
    public: true, publicTitle: 'Invoices unavailable',
    updates: [
      upd(5 * MIN, 'identified', 'We found the cause: the invoice service lost its database connection. A fix is being rolled out.', true),
      upd(6 * MIN, 'identified', 'Prisma P1001: cannot reach finvault.db after the container restarted 3 times.', false),
      upd(14 * MIN, 'investigating', 'Creating and paying invoices is failing right now. We are looking into it.', true),
      upd(16 * MIN, 'investigating', 'Health check on :8003 returns ECONNREFUSED; alert sent to Discord and push.', false, 'nexuswatch'),
    ],
    postmortem: null,
  },
  {
    id: 'inc_3', title: 'node-02 is slow', severity: 'warning', status: 'monitoring',
    summary: 'CPU 78% and memory 82%; heartbeat above the 100 ms threshold.',
    serviceIds: ['nx-agent-node-02'], startedAt: ago(32 * MIN), resolvedAt: null,
    public: false, publicTitle: 'Slower game servers',
    updates: [
      upd(20 * MIN, 'monitoring', 'Moved the valheim backup job off-peak. Watching heartbeat latency.', false),
      upd(32 * MIN, 'investigating', 'CPU 78% and memory 82% on vm-laptop; heartbeat above the 100 ms threshold.', false, 'nexuswatch'),
    ],
    postmortem: null,
  },
  {
    id: 'inc_5', title: 'invoice-service returns 5xx', severity: 'critical', status: 'resolved',
    summary: 'A third of invoice requests failed for an hour after a migration.',
    serviceIds: ['fv-invoice-service', 'fv-api-gateway'], startedAt: ago(11 * DAY + HOUR), resolvedAt: ago(11 * DAY),
    public: true, publicTitle: 'Elevated errors creating invoices',
    updates: [
      upd(11 * DAY, 'resolved', 'Invoices are working normally again. We are sorry for the trouble.', true),
      upd(11 * DAY + 15 * MIN, 'monitoring', 'A fix is live and error rates are back to normal. We are keeping an eye on it.', true),
      upd(11 * DAY + 35 * MIN, 'identified', 'EPC069-12 QR generation fails on legacy invoices without an IBAN after migration 0042.', false),
      upd(11 * DAY + 50 * MIN, 'investigating', 'Some invoices cannot be created. We are investigating.', true),
    ],
    postmortem: {
      summary: 'For about an hour, roughly a third of requests to create an invoice failed with a 5xx. Existing invoices and payments were not affected.',
      rootCause: 'Migration 0042 made the IBAN column required for QR generation without backfilling legacy invoices, so the EPC069-12 path threw for every invoice without one.',
      actionItems: [
        { id: 'ai_1', title: 'Backfill IBAN on legacy invoices', owner: 'tom', done: true },
        { id: 'ai_2', title: 'Alert on 5xx rate per service, not only at the gateway', owner: 'tom', done: true },
        { id: 'ai_3', title: 'Run migrations against a production snapshot in CI', owner: 'tom', done: false },
      ],
    },
  },
  {
    id: 'inc_2', title: 'node-agent · node-02 offline', severity: 'critical', status: 'resolved',
    summary: 'VM rebooted after a host update; the agent reconnected on its own.',
    serviceIds: ['nx-agent-node-02'], startedAt: ago(37 * DAY), resolvedAt: ago(37 * DAY - 8 * MIN),
    public: false, publicTitle: 'Game servers briefly unreachable',
    updates: [
      upd(37 * DAY - 8 * MIN, 'resolved', 'Agent reconnected after the VM came back.', false, 'nexuswatch'),
      upd(37 * DAY, 'investigating', 'agent_last_seen > 90 s for node-02.', false, 'nexuswatch'),
    ],
    postmortem: {
      summary: 'node-02 was unreachable for 8 minutes while its VM host installed updates and rebooted.',
      rootCause: 'Automatic host updates are allowed to reboot during the day.',
      actionItems: [{ id: 'ai_4', title: 'Restrict automatic reboots to the maintenance window', owner: 'tom', done: false }],
    },
  },
  {
    id: 'inc_1', title: 'invoice-service crash loop', severity: 'critical', status: 'resolved',
    summary: 'A database migration was missing; fixed with a redeploy.',
    serviceIds: ['fv-invoice-service'], startedAt: ago(62 * DAY), resolvedAt: ago(62 * DAY - 41 * MIN),
    public: true, publicTitle: 'Invoices unavailable',
    updates: [
      upd(62 * DAY - 41 * MIN, 'resolved', 'Invoices are available again.', true),
      upd(62 * DAY, 'investigating', 'Invoices cannot be created right now. We are investigating.', true),
    ],
    postmortem: {
      summary: 'Invoices were unavailable for 41 minutes after a deploy.',
      rootCause: 'The deploy shipped without its database migration, so the service crashed on start.',
      actionItems: [{ id: 'ai_5', title: 'Run migrations as part of the container start', owner: 'tom', done: true }],
    },
  },
];

function toDetail(s: StoredIncident): IncidentDetail {
  const { serviceIds, ...rest } = s;
  const end = s.resolvedAt ? new Date(s.resolvedAt).getTime() : Date.now();
  return {
    ...structuredClone(rest),
    affected: serviceIds.map((id) => {
      const svc = services.find((x) => x.id === id);
      return { serviceId: id, name: svc?.name ?? id, project: svc?.project ?? ('nexusinfra' as ProjectId) };
    }),
    durationSeconds: Math.max(0, Math.round((end - new Date(s.startedAt).getTime()) / 1000)),
  };
}

const sorted = () =>
  [...incidentStore].sort((a, b) => Number(b.status !== 'resolved') - Number(a.status !== 'resolved') || b.startedAt.localeCompare(a.startedAt));

export function incidents(): IncidentsData {
  const list = sorted().map(toDetail);
  const recent = list.filter((i) => Date.now() - new Date(i.startedAt).getTime() <= 30 * DAY * 1000);
  const resolved = recent.filter((i) => i.status === 'resolved');
  return {
    incidents: list,
    summary: {
      open: list.filter((i) => i.status !== 'resolved').length,
      last30d: recent.length,
      mttrMinutes: resolved.length ? Math.round(resolved.reduce((sum, i) => sum + i.durationSeconds, 0) / resolved.length / 60) : null,
    },
  };
}

export function incident(id: string): IncidentDetail | null {
  const s = incidentStore.find((i) => i.id === id);
  return s ? toDetail(s) : null;
}

/** The short list Heartbeats shows; each entry links to its incident. */
export function incidentSummaries(): Incident[] {
  return sorted().map((s) => {
    const d = toDetail(s);
    return { id: d.id, open: d.status !== 'resolved', severity: d.severity, title: d.title, note: d.summary, startedAt: d.startedAt, durationSeconds: d.durationSeconds };
  });
}

function find(id: string): StoredIncident {
  const s = incidentStore.find((i) => i.id === id);
  if (!s) throw new ApiError(404, `Incident ${id} not found`);
  return s;
}

export function createIncident(input: NewIncident): IncidentDetail {
  const title = input.title.trim();
  if (!title) throw new ApiError(400, 'An incident needs a title');
  if (input.serviceIds.length === 0) throw new ApiError(400, 'Pick at least one affected service');
  const id = `inc_${incidentStore.reduce((max, i) => Math.max(max, Number(i.id.slice(4)) || 0), 0) + 1}`;
  const message = input.message.trim() || 'We are investigating.';
  const stored: StoredIncident = {
    id, title, severity: input.severity, status: 'investigating', summary: message,
    serviceIds: [...input.serviceIds], startedAt: ago(0), resolvedAt: null,
    public: input.public, publicTitle: input.publicTitle?.trim() || title,
    updates: [upd(0, 'investigating', message, input.public)],
    postmortem: null,
  };
  incidentStore.push(stored);
  return toDetail(stored);
}

export function postIncidentUpdate(id: string, input: NewIncidentUpdate): IncidentDetail {
  const s = find(id);
  if (s.status === 'resolved') throw new ApiError(409, 'This incident is already resolved');
  if (!input.message.trim()) throw new ApiError(400, 'An update needs a message');
  s.status = input.status;
  s.updates.unshift(upd(0, input.status, input.message.trim(), input.public));
  return toDetail(s);
}

export function resolveIncident(id: string, input: ResolveIncident): IncidentDetail {
  const s = find(id);
  if (s.status === 'resolved') throw new ApiError(409, 'This incident is already resolved');
  s.status = 'resolved';
  s.resolvedAt = ago(0);
  s.updates.unshift(upd(0, 'resolved', input.message.trim() || 'This incident has been resolved.', input.public));
  if (input.postmortem) s.postmortem = structuredClone(input.postmortem);
  return toDetail(s);
}

/** The incident store as plain JSON. The collector stores it so declared incidents survive a restart. */
export interface IncidentState {
  updateSeq: number;
  incidents: StoredIncident[];
}

export function incidentState(): IncidentState {
  return structuredClone({ updateSeq, incidents: incidentStore });
}

/** Replaces the incident store with a snapshot from `incidentState()`. */
export function restoreIncidentState(state: IncidentState): void {
  updateSeq = Math.max(updateSeq, state.updateSeq);
  incidentStore.splice(0, incidentStore.length, ...structuredClone(state.incidents));
}

// ── Public status page ─────────────────────────────────────────────────
interface ComponentSpec {
  slug: string;
  name: string;
  project: ProjectId;
  serviceIds: string[];
  /** [day index 0–89 (89 = today), minutes of downtime] */
  downtime?: [number, number][];
}

const STATUS_DAYS = 90;
/** Monitoring started 85 days ago: the first days have no data. */
const FIRST_DAY_WITH_DATA = STATUS_DAYS - 85;

const COMPONENTS: ComponentSpec[] = [
  { slug: 'nexusinfra-api', name: 'API', project: 'nexusinfra', serviceIds: ['nx-api-gateway'] },
  { slug: 'provisioning', name: 'Server provisioning', project: 'nexusinfra', serviceIds: ['nx-orchestrator'], downtime: [[80, 10]] },
  { slug: 'control-panel', name: 'Control panel', project: 'nexusinfra', serviceIds: ['nx-control-room'] },
  { slug: 'game-servers', name: 'Game & web servers', project: 'nexusinfra', serviceIds: ['nx-agent-node-01', 'nx-agent-node-02'], downtime: [[52, 8], [62, 8]] },
  { slug: 'billing', name: 'Billing', project: 'nexusinfra', serviceIds: ['nx-billing-bridge'], downtime: [[85, 20]] },
  { slug: 'finvault-api', name: 'API', project: 'finvault', serviceIds: ['fv-api-gateway'], downtime: [[87, 3]] },
  { slug: 'accounts', name: 'Accounts & sign-in', project: 'finvault', serviceIds: ['fv-account-service'] },
  { slug: 'wallets', name: 'Wallets & transfers', project: 'finvault', serviceIds: ['fv-wallet-service'], downtime: [[89, 5]] },
  { slug: 'invoices', name: 'Invoices', project: 'finvault', serviceIds: ['fv-invoice-service'], downtime: [[27, 41], [78, 60], [89, 16]] },
];

const HEALTH_RANK: Record<HealthStatus, number> = { up: 0, slow: 1, down: 2 };
const worseHealth = (a: HealthStatus, b: HealthStatus) => (HEALTH_RANK[b] > HEALTH_RANK[a] ? b : a);
const NOW_CELL: Record<PublicStatus, HealthStatus> = { operational: 'up', maintenance: 'up', degraded: 'slow', 'partial-outage': 'down', 'major-outage': 'down' };
const dayStatus = (downMinutes: number): HealthStatus => (downMinutes >= 15 ? 'down' : downMinutes > 0 ? 'slow' : 'up');

/** Builds a public component by copying only public fields — never spread an internal object in here. */
function buildComponent(spec: ComponentSpec): StatusComponent {
  const internal = spec.serviceIds.map((id) => services.find((s) => s.id === id)!);
  const status = worstStatus(internal.map((s) => toPublicStatus(s.status)));
  let known = 0;
  let downMinutes = 0;
  const days = Array.from({ length: STATUS_DAYS }, (_, i): HealthStatus | null => {
    if (i < FIRST_DAY_WITH_DATA) return null;
    known++;
    const minutes = spec.downtime?.find(([d]) => d === i)?.[1] ?? 0;
    downMinutes += minutes;
    const day = dayStatus(minutes);
    // Today also reflects the current state, whichever is worse.
    return i === STATUS_DAYS - 1 ? worseHealth(day, NOW_CELL[status]) : day;
  });
  return {
    slug: spec.slug,
    name: spec.name,
    status,
    uptimePct: known ? 100 * (1 - downMinutes / (known * 24 * 60)) : null,
    days,
  };
}

function toPublicIncident(d: IncidentDetail, componentNames: (serviceId: string) => string[]): PublicIncident {
  return {
    slug: d.id,
    title: d.publicTitle,
    status: d.status,
    impact: d.severity,
    startedAt: d.startedAt,
    resolvedAt: d.resolvedAt,
    components: [...new Set(d.affected.flatMap((a) => componentNames(a.serviceId)))],
    updates: d.updates.filter((u) => u.public).map((u) => ({ at: u.at, status: u.status, message: u.message })),
  };
}

const maintenanceWindows = (): Maintenance[] => [
  {
    slug: 'mnt-finvault-db', title: 'FinVault database upgrade',
    description: 'Wallets and invoices are read-only for up to 30 minutes while the database moves to a new disk.',
    startsAt: at(2 * DAY), endsAt: at(2 * DAY + 30 * MIN), components: ['Wallets & transfers', 'Invoices'],
  },
  {
    slug: 'mnt-game-servers', title: 'Game server host updates',
    description: 'Game and web servers restart one at a time; each is away for a few minutes.',
    startsAt: at(6 * DAY), endsAt: at(6 * DAY + HOUR), components: ['Game & web servers'],
  },
];

export function statusPage(): StatusPageData {
  const components = COMPONENTS.map((spec) => ({ spec, component: buildComponent(spec) }));
  const namesFor = (serviceId: string) => components.filter((c) => c.spec.serviceIds.includes(serviceId)).map((c) => c.component.name);
  const maintenance = maintenanceWindows();
  const now = Date.now();
  const inProgress = maintenance.some((m) => new Date(m.startsAt).getTime() <= now && now < new Date(m.endsAt).getTime());
  const published = incidents().incidents.filter((i) => i.public);
  return {
    overall: overallStatus(components.map((c) => c.component.status), inProgress),
    updatedAt: at(0),
    groups: (['nexusinfra', 'finvault'] as const).map((project) => ({
      project,
      name: project === 'nexusinfra' ? 'NexusInfra' : 'FinVault',
      components: components.filter((c) => c.spec.project === project).map((c) => c.component),
    })),
    active: published.filter((i) => i.status !== 'resolved').map((i) => toPublicIncident(i, namesFor)),
    recent: published
      .filter((i) => i.status === 'resolved' && i.resolvedAt && now - new Date(i.resolvedAt).getTime() <= 14 * DAY * 1000)
      .map((i) => toPublicIncident(i, namesFor)),
    maintenance: maintenance.filter((m) => new Date(m.endsAt).getTime() > now),
  };
}
