/**
 * The Docker Engine on the machine the collector runs on, read through its socket: every container
 * with its state, CPU, memory, uptime and restarts, plus network throughput summed over containers.
 *
 * Read-only by use: only GET requests are ever sent (list, inspect, stats, info). Mount the socket
 * read-only (`/var/run/docker.sock:/var/run/docker.sock:ro`); note that the Engine API itself has no
 * read-only mode, so whoever controls the collector's code controls Docker — the same trust Dozzle gets.
 *
 * Which project a container belongs to:
 * - `nexusinfra.managed=true` (a customer server NexusInfra's node agent started) → nexusinfra
 * - compose project `finvault*` → finvault, `nexusinfra*` → nexusinfra
 * - anything else (NexusWatch itself, Dozzle, …) → null: listed, never counted as a project's
 */
import { request } from 'node:http';
import type { ProjectId } from '../contract.js';
import type { Store } from '../store.js';
import type { Clock } from './types.js';

export interface DockerApi {
  get<T>(path: string): Promise<T>;
}

/** GET over a unix socket; rejects on a non-2xx answer or after `timeoutMs`. */
export function socketApi(socketPath: string, timeoutMs = 10_000): DockerApi {
  return {
    get: <T>(path: string) =>
      new Promise<T>((resolve, reject) => {
        const req = request({ socketPath, path, method: 'GET', timeout: timeoutMs, headers: { Accept: 'application/json' } }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 0) >= 300) return reject(new Error(`docker ${path} answered HTTP ${res.statusCode}`));
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              reject(new Error(`docker ${path}: not JSON`));
            }
          });
        });
        req.on('timeout', () => req.destroy(new Error(`docker ${path} timed out`)));
        req.on('error', reject);
        req.end();
      }),
  };
}

export const MANAGED_LABEL = 'nexusinfra.managed';
const COMPOSE_PROJECT = 'com.docker.compose.project';

export function projectOf(labels: Record<string, string> | null | undefined): ProjectId | null {
  if (labels?.[MANAGED_LABEL] === 'true') return 'nexusinfra';
  const stack = labels?.[COMPOSE_PROJECT] ?? '';
  if (stack.startsWith('finvault')) return 'finvault';
  if (stack.startsWith('nexusinfra')) return 'nexusinfra';
  return null;
}

/** What the views read: the last poll, one row per container. */
export interface ContainerState {
  id: string;
  name: string;
  image: string;
  state: 'running' | 'stopped' | 'restarting';
  project: ProjectId | null;
  /** The compose project, or null for a container outside compose. */
  stack: string | null;
  /** null when not running or not measured. */
  cpuPct: number | null;
  memoryBytes: number | null;
  /** When the current run started; null when not running. */
  startedAt: number | null;
  restarts: number;
}

export interface DockerSnapshot {
  ts: number;
  /** The Docker host's name (`docker info`), so the dashboard names the server, not the container. */
  host: string | null;
  containers: ContainerState[];
}

export const SNAPSHOT_KEY = 'docker:snapshot';

interface ListItem {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Labels: Record<string, string> | null;
}
interface Inspect {
  RestartCount?: number;
  State?: { Status?: string; StartedAt?: string; Restarting?: boolean };
}
interface Stats {
  cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; stats?: Record<string, number> };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
  blkio_stats?: { io_service_bytes_recursive?: { op?: string; value?: number }[] | null };
}

/** CPU in % of the whole machine (100 = every core busy), Docker's own formula. Null without a previous reading. */
export function cpuPercent(s: Stats): number | null {
  const cpu = (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const system = (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
  if (!s.precpu_stats?.system_cpu_usage || system <= 0 || cpu < 0) return null;
  return Math.round((cpu / system) * 10_000) / 100;
}

/** Memory as `docker stats` shows it: usage less the reclaimable page cache. */
export function memoryBytes(s: Stats): number | null {
  const usage = s.memory_stats?.usage;
  if (typeof usage !== 'number') return null;
  const cache = s.memory_stats?.stats?.inactive_file ?? s.memory_stats?.stats?.total_inactive_file ?? s.memory_stats?.stats?.cache ?? 0;
  return Math.max(0, usage - cache);
}

const stateOf = (list: string, inspect: Inspect): ContainerState['state'] =>
  inspect.State?.Restarting || list === 'restarting' ? 'restarting' : list === 'running' ? 'running' : 'stopped';

export class DockerSource {
  /** Network byte totals per container at the previous poll, for rates. */
  private previous = new Map<string, { ts: number; rx: number; tx: number; io: number }>();

  constructor(
    private readonly store: Store,
    private readonly api: DockerApi,
    private readonly clock: Clock,
  ) {}

  async poll(): Promise<DockerSnapshot> {
    const [list, info] = await Promise.all([
      this.api.get<ListItem[]>('/containers/json?all=1'),
      this.api.get<{ Name?: string }>('/info').catch(() => ({}) as { Name?: string }),
    ]);
    const now = this.clock();
    let rxRate = 0;
    let txRate = 0;
    let ioRate = 0;
    let measuredNet = false;
    let measuredIo = false;
    const seen = new Map<string, { ts: number; rx: number; tx: number; io: number }>();

    const containers = await Promise.all(
      list.map(async (c): Promise<ContainerState> => {
        const inspect = await this.api.get<Inspect>(`/containers/${c.Id}/json`).catch(() => ({}) as Inspect);
        const state = stateOf(c.State, inspect);
        const name = (c.Names[0] ?? c.Id.slice(0, 12)).replace(/^\//, '');
        const started = inspect.State?.StartedAt ? Date.parse(inspect.State.StartedAt) : NaN;
        let cpu: number | null = null;
        let mem: number | null = null;
        if (state === 'running') {
          const stats = await this.api.get<Stats>(`/containers/${c.Id}/stats?stream=false`).catch(() => null);
          if (stats) {
            cpu = cpuPercent(stats);
            mem = memoryBytes(stats);
            const rx = Object.values(stats.networks ?? {}).reduce((a, n) => a + (n.rx_bytes ?? 0), 0);
            const tx = Object.values(stats.networks ?? {}).reduce((a, n) => a + (n.tx_bytes ?? 0), 0);
            // Bytes read + written, cgroup v1 (`Read`/`Write`) and v2 (`read`/`write`) alike.
            const io = (stats.blkio_stats?.io_service_bytes_recursive ?? [])
              .filter((e) => /^(read|write)$/i.test(e.op ?? ''))
              .reduce((a, e) => a + (e.value ?? 0), 0);
            seen.set(c.Id, { ts: now, rx, tx, io });
            const prev = this.previous.get(c.Id);
            if (prev && now > prev.ts) {
              const seconds = (now - prev.ts) / 1000;
              if (stats.networks && rx >= prev.rx && tx >= prev.tx) {
                rxRate += (rx - prev.rx) / seconds;
                txRate += (tx - prev.tx) / seconds;
                measuredNet = true;
              }
              if (io >= prev.io) {
                ioRate += (io - prev.io) / seconds;
                measuredIo = true;
              }
            }
          }
        }
        return {
          id: c.Id.slice(0, 12),
          name,
          image: c.Image,
          state,
          project: projectOf(c.Labels),
          stack: c.Labels?.[COMPOSE_PROJECT] ?? null,
          cpuPct: cpu,
          memoryBytes: mem,
          startedAt: state === 'running' && Number.isFinite(started) ? started : null,
          restarts: inspect.RestartCount ?? 0,
        };
      }),
    );
    this.previous = seen;

    for (const c of containers) {
      if (c.cpuPct !== null) this.store.addSample('container_cpu', c.name, now, c.cpuPct);
    }
    this.store.addSample('docker_containers', 'running', now, containers.filter((c) => c.state === 'running').length);
    // Mbit/s, summed over every container (bytes/s × 8 / 1e6). Needs two polls.
    const memory = containers.filter((c) => c.memoryBytes !== null);
    if (memory.length) this.store.addSample('docker_memory', 'total', now, memory.reduce((a, c) => a + (c.memoryBytes as number), 0));
    if (measuredIo) this.store.addSample('disk_io', 'total', now, Math.round(ioRate / 1e4) / 100); // MB/s
    if (measuredNet) {
      this.store.addSample('network', 'inbound', now, Math.round((rxRate * 8) / 1e4) / 100);
      this.store.addSample('network', 'outbound', now, Math.round((txRate * 8) / 1e4) / 100);
    }
    const snapshot: DockerSnapshot = { ts: now, host: info.Name ?? null, containers };
    this.store.set(SNAPSHOT_KEY, snapshot);
    return snapshot;
  }
}
