import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { Store } from '../store.js';
import { createCtx } from '../views/ctx.js';
import { hostName, nexusInfraContainers, topContainers } from '../views/containers.js';
import { metricsOverview } from '../views/metrics.js';
import { cpuPercent, DockerSource, memoryBytes, projectOf, type DockerApi } from './docker.js';

const stats = (cpu: number, sys: number, mem: number, rx: number, io: number) => ({
  cpu_stats: { cpu_usage: { total_usage: cpu }, system_cpu_usage: sys, online_cpus: 4 },
  precpu_stats: { cpu_usage: { total_usage: cpu - 50 }, system_cpu_usage: sys - 1000 },
  memory_stats: { usage: mem, stats: { inactive_file: 1000 } },
  networks: { eth0: { rx_bytes: rx, tx_bytes: rx / 2 } },
  blkio_stats: { io_service_bytes_recursive: [{ op: 'read', value: io }, { op: 'write', value: io }] },
});

function fakeApi(round: () => number): DockerApi {
  const list = [
    { Id: 'aaa111aaa111aaa', Names: ['/finvault-gateway'], Image: 'finvault-gateway:latest', State: 'running', Labels: { 'com.docker.compose.project': 'finvault' } },
    { Id: 'bbb222bbb222bbb', Names: ['/mc-1'], Image: 'itzg/minecraft-server', State: 'running', Labels: { 'nexusinfra.managed': 'true' } },
    { Id: 'ccc333ccc333ccc', Names: ['/nexusinfra-billing-gateway'], Image: 'ghcr.io/x/gateway:0.4.1', State: 'exited', Labels: { 'com.docker.compose.project': 'nexusinfra-hosted' } },
    { Id: 'ddd444ddd444ddd', Names: ['/dozzle'], Image: 'amir20/dozzle', State: 'running', Labels: { 'com.docker.compose.project': 'tools' } },
  ];
  return {
    get: async <T,>(path: string) => {
      const r = round();
      if (path.startsWith('/containers/json')) return list as T;
      if (path === '/info') return { Name: 'home-server' } as T;
      if (path.endsWith('/json')) return { RestartCount: path.includes('bbb') ? 2 : 0, State: { StartedAt: new Date(Date.UTC(2026, 10, 25, 10)).toISOString() } } as T;
      const big = path.includes('bbb') ? 4 : 1;
      return stats(1000 * r, 100_000 * r, 2_000_000 * big, 1_000_000 * r, 5_000_000 * r) as T;
    },
  };
}

describe('Docker source', () => {
  it('maps containers to projects by their labels', () => {
    expect(projectOf({ 'nexusinfra.managed': 'true' })).toBe('nexusinfra');
    expect(projectOf({ 'com.docker.compose.project': 'finvault' })).toBe('finvault');
    expect(projectOf({ 'com.docker.compose.project': 'nexusinfra-community' })).toBe('nexusinfra');
    expect(projectOf({ 'com.docker.compose.project': 'nexuswatch' })).toBeNull();
    expect(projectOf(null)).toBeNull();
  });

  it('computes CPU like docker stats and needs a previous reading', () => {
    expect(cpuPercent(stats(1000, 100_000, 0, 0, 0))).toBe(5);
    expect(cpuPercent({ cpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 10 } })).toBeNull();
    expect(memoryBytes(stats(0, 0, 5000, 0, 0))).toBe(4000);
  });

  it('feeds top consumers, the NexusInfra list, network and the host name', async () => {
    let n = 1;
    let now = Date.UTC(2026, 10, 25, 12);
    const store = new Store();
    const ctx = createCtx(store, loadConfig({ NW_DOCKER_SOCKET: '/var/run/docker.sock' }), { clock: () => now });
    const source = new DockerSource(store, fakeApi(() => n), () => now);
    await source.poll();
    n = 2;
    now += 15_000;
    await source.poll();

    expect(hostName(ctx)).toBe('home-server');
    const top = topContainers(ctx);
    expect(top.map((t) => [t.name, t.project])).toEqual([['finvault-gateway', 'finvault'], ['mc-1', 'nexusinfra']]);
    expect(top[0]).toMatchObject({ node: 'home-server', cpuPct: 5 });
    const rows = nexusInfraContainers(ctx);
    expect(rows.map((r) => [r.name, r.state, r.restarts])).toEqual([['mc-1', 'running', 2], ['nexusinfra-billing-gateway', 'stopped', 0]]);
    expect(rows[1].uptime).toBe('-');
    // 1 MB more received per running container (three) in 15 s: 3 MB / 15 s = 1.6 Mbit/s.
    expect(store.latestSamples('network').find((s) => s.series === 'inbound')?.value).toBeCloseTo(1.6, 1);
    const summaries = metricsOverview(ctx, '1h').summaries;
    expect(summaries.find((s) => s.title === 'Containers running')?.value).toBe('3');
    expect(summaries.find((s) => s.title === 'Network in')?.value).not.toBe('31');
    expect(metricsOverview(ctx, '1h').topContainers).toEqual(top);
  });

  it('prefers NW_HOST_NAME over the Docker host name', async () => {
    const store = new Store();
    const ctx = createCtx(store, loadConfig({ NW_DOCKER_SOCKET: '/x', NW_HOST_NAME: 'tom-server' }), { clock: () => 0 });
    await new DockerSource(store, fakeApi(() => 1), () => 0).poll();
    expect(hostName(ctx)).toBe('tom-server');
  });
});
