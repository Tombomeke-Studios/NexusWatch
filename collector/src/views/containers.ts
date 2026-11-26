/** Containers from the Docker socket (`sources/docker.ts`): top consumers, the NexusInfra list, the host's name. */
import { formatBytes, formatDuration } from '@/lib/format';
import type { ContainerRow, ContainerUsage } from '../contract.js';
import { SNAPSHOT_KEY, type ContainerState, type DockerSnapshot } from '../sources/docker.js';
import type { Ctx } from './ctx.js';

const FIVE_MIN = 5 * 60_000;

export function snapshot(ctx: Ctx): DockerSnapshot | null {
  return ctx.live.docker ? (ctx.store.get<DockerSnapshot>(SNAPSHOT_KEY) ?? null) : null;
}

/** The server's name: NW_HOST_NAME, else what Docker calls its host, else this machine's (a container id in Docker). */
export function hostName(ctx: Ctx): string {
  if (ctx.config.host.explicit) return ctx.config.host.name;
  return snapshot(ctx)?.host ?? ctx.config.host.name;
}

/** Mean CPU over the last five minutes per container, from the stored samples. */
function cpuLast5Min(ctx: Ctx): Map<string, number> {
  const now = ctx.clock();
  const sums = new Map<string, { total: number; n: number }>();
  for (const s of ctx.store.samples('container_cpu', now - FIVE_MIN, now)) {
    const e = sums.get(s.series) ?? { total: 0, n: 0 };
    e.total += s.value;
    e.n += 1;
    sums.set(s.series, e);
  }
  return new Map([...sums].map(([k, v]) => [k, Math.round((v.total / v.n) * 10) / 10]));
}

/** Running containers of the two projects by CPU, last five minutes; unmeasured ones are left out. */
export function topContainers(ctx: Ctx, limit = 6): ContainerUsage[] {
  const snap = snapshot(ctx);
  if (!snap) return [];
  const cpu = cpuLast5Min(ctx);
  const node = hostName(ctx);
  return snap.containers
    .filter((c): c is ContainerState & { project: NonNullable<ContainerState['project']> } => c.state === 'running' && c.project !== null)
    .map((c) => ({ c, pct: cpu.get(c.name) ?? c.cpuPct }))
    .filter((x): x is { c: ContainerState & { project: NonNullable<ContainerState['project']> }; pct: number } => x.pct !== null)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, limit)
    .map(({ c, pct }) => ({ name: c.name, project: c.project, node, cpuPct: pct, memoryBytes: c.memoryBytes ?? 0 }));
}

/** Every NexusInfra container (its stacks and the customer servers it manages), running first. */
export function nexusInfraContainers(ctx: Ctx): ContainerRow[] {
  const snap = snapshot(ctx);
  if (!snap) return [];
  const node = hostName(ctx);
  const order = { running: 0, restarting: 1, stopped: 2 } as const;
  return snap.containers
    .filter((c) => c.project === 'nexusinfra')
    .sort((a, b) => order[a.state] - order[b.state] || (b.cpuPct ?? 0) - (a.cpuPct ?? 0))
    .map((c) => ({
      name: c.name,
      image: c.image,
      node,
      state: c.state,
      cpuPct: c.cpuPct ?? 0,
      memory: c.memoryBytes === null ? '—' : formatBytes(c.memoryBytes),
      uptime: c.startedAt === null ? '-' : formatDuration((snap.ts - c.startedAt) / 1000),
      restarts: c.restarts,
    }));
}
