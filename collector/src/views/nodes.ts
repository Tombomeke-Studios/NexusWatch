/** Nodes — from the Control Room and/or node heartbeats on the bus. */
import type { Gauge, NodeSummary } from '../contract.js';
import { liveSources } from '../sources/heartbeat.js';
import { seconds, type Ctx } from './ctx.js';
import { round } from './series.js';

interface Resources {
  cpuPercent?: number;
  ramUsedMb?: number;
  ramTotalMb?: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Only what the node measured: a gauge it did not report is left out, not drawn as 0. */
export function gauges(r: Resources | undefined): Gauge[] {
  if (!r) return [];
  const out: Gauge[] = [];
  if (finite(r.cpuPercent)) out.push({ label: 'CPU', pct: round(r.cpuPercent), text: `${round(r.cpuPercent)}%` });
  if (finite(r.ramUsedMb) && finite(r.ramTotalMb) && r.ramTotalMb > 0)
    out.push({ label: 'Memory', pct: round((r.ramUsedMb / r.ramTotalMb) * 100), text: `${round(r.ramUsedMb / 1024, 1)} / ${round(r.ramTotalMb / 1024, 1)} GB` });
  if (finite(r.diskUsedGb) && finite(r.diskTotalGb) && r.diskTotalGb > 0)
    out.push({ label: 'Disk', pct: round((r.diskUsedGb / r.diskTotalGb) * 100), text: `${round(r.diskUsedGb)} / ${round(r.diskTotalGb)} GB` });
  return out;
}

export function nodes(ctx: Ctx): NodeSummary[] {
  if (!ctx.live.nodes) return ctx.sample.nodes;
  const now = ctx.clock();
  return liveSources(ctx.store, 'node', now).map((s) => ({
    id: s.name,
    name: s.name,
    status: s.status,
    host: typeof s.detail.host === 'string' ? s.detail.host : s.detail.connection === 'outbound' ? 'agent link' : s.name,
    lastBeatSeconds: seconds(now - s.lastSeen),
    // Container counts and agent versions are not on the heartbeat yet (see TODO).
    containers: 0,
    agentVersion: 'unknown',
    gauges: gauges(s.detail.resources as Resources | undefined),
  }));
}
