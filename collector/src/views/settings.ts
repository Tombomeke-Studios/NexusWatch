/**
 * Settings. Channel switches, routing and retention are stored (whatever the dashboard last wrote, else
 * the sample defaults); storage use is measured; agents are sample data until the agent exists.
 */
import { statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SettingsData } from '../contract.js';
import { parseDuration } from '../duration.js';
import { CHANNEL_VARIABLES, maskTarget } from '../notify/channels.js';
import { effectiveTargets, targetSource } from '../notify/targets.js';
import type { RetentionKind } from '../store.js';
import type { Ctx } from './ctx.js';

const KEY = 'settings';
export type SettingsPatch = Partial<Pick<SettingsData, 'channels' | 'routing' | 'retention'>>;
type Stored = Omit<SettingsPatch, 'channels'> & { channels?: { id: string; enabled: boolean }[] };

function diskBytes(path: string): number | null {
  try {
    const s = statfsSync(path === ':memory:' ? '.' : dirname(resolve(path)));
    return s.blocks * s.bsize;
  } catch {
    return null;
  }
}

export function settings(ctx: Ctx): SettingsData {
  const base = ctx.sample.settings();
  const stored = ctx.store.get<Stored>(KEY) ?? {};
  const usage = ctx.store.usage();
  const retention = (stored.retention ?? base.retention).map((r) => ({ ...r, usedBytes: usage.perKind[r.id] ?? 0 }));
  return {
    ...base,
    // Live: the agents are NexusInfra's node agents heard on the bus or reported by the Control Room
    // (NexusWatch's own agent is not built, so there is no token to show).
    agentSource: ctx.live.logs ? 'nexusinfra' : base.agentSource,
    agents: ctx.live.logs
      ? ctx.store.sources('node').map((n) => ({
          id: n.name,
          name: n.name,
          host: typeof n.detail.host === 'string' ? n.detail.host : n.origin,
          tokenHint: '',
          version: typeof n.detail.version === 'string' ? n.detail.version : '—',
          lastSeenSeconds: Math.max(0, Math.round((ctx.clock() - n.lastSeen) / 1000)),
          status: n.status,
        }))
      : base.agents,
    serverUrl: ctx.config.notify.publicUrl ?? (ctx.live.logs ? 'set NW_PUBLIC_URL' : base.serverUrl),
    // Where a channel sends to is the collector's configuration, shown masked; only its switch is stored.
    channels: base.channels.map((c) => {
      const targets = effectiveTargets(ctx);
      const target = maskTarget(c.id, targets);
      const saved = stored.channels?.find((x) => x.id === c.id);
      const source = targetSource(ctx, c.id);
      // A channel is on once it has a target, unless someone switched it off.
      return { ...c, enabled: target !== null && (saved?.enabled ?? true), configured: target !== null, source, target: target ?? `Not set up — use "Set up", or set ${CHANNEL_VARIABLES[c.id]}` };
    }),
    routing: stored.routing ? { ...base.routing, ...stored.routing } : base.routing,
    retention,
    storage: { usedBytes: usage.fileBytes, totalBytes: diskBytes(ctx.store.path) ?? base.storage.totalBytes },
  };
}

/** Switches one channel on or off (setting a channel up switches it on). */
export function setChannelEnabled(ctx: Ctx, id: string, enabled: boolean): void {
  const stored = ctx.store.get<Stored>(KEY) ?? {};
  const channels = (stored.channels ?? []).filter((c) => c.id !== id);
  ctx.store.set(KEY, { ...stored, channels: [...channels, { id, enabled }] });
}

/** Throws (→ 400) on a retention value that is not one of its options or not a duration. */
export function updateSettings(ctx: Ctx, patch: SettingsPatch): void {
  const current = settings(ctx);
  if (patch.channels && !Array.isArray(patch.channels)) throw new Error('channels must be a list');
  if (patch.retention) {
    for (const r of patch.retention) {
      const known = current.retention.find((x) => x.id === r.id);
      if (!known) throw new Error(`unknown retention kind "${r.id}"`);
      if (!known.options.includes(r.current)) throw new Error(`retention for ${r.id} must be one of ${known.options.join(', ')}`);
      parseDuration(r.current);
    }
  }
  const stored = ctx.store.get<Stored>(KEY) ?? {};
  ctx.store.set(KEY, {
    ...stored,
    ...(patch.channels ? { channels: patch.channels.map(({ id, enabled }) => ({ id, enabled: enabled === true })) } : {}),
    ...(patch.routing ? { routing: { ...(stored.routing ?? {}), ...patch.routing } } : {}),
    ...(patch.retention ? { retention: patch.retention.map(({ id, label, current, options }) => ({ id, label, current, options, usedBytes: 0 })) } : {}),
  });
  if (patch.retention) prune(ctx);
}

export function retentionMs(ctx: Ctx): Record<RetentionKind, number> {
  const out = {} as Record<RetentionKind, number>;
  for (const r of settings(ctx).retention) out[r.id] = parseDuration(r.current);
  return out;
}

export function prune(ctx: Ctx): Record<RetentionKind, number> {
  return ctx.store.prune(retentionMs(ctx), ctx.clock());
}
