/**
 * Settings. Channels, routing and retention are stored (whatever the dashboard last wrote, else
 * the sample defaults); storage use is measured; agents are sample data until the agent exists.
 */
import { statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SettingsData } from '../contract.js';
import { parseDuration } from '../duration.js';
import type { RetentionKind } from '../store.js';
import type { Ctx } from './ctx.js';

const KEY = 'settings';
export type SettingsPatch = Partial<Pick<SettingsData, 'channels' | 'routing' | 'retention'>>;

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
  const stored = ctx.store.get<SettingsPatch>(KEY) ?? {};
  const usage = ctx.store.usage();
  const retention = (stored.retention ?? base.retention).map((r) => ({ ...r, usedBytes: usage.perKind[r.id] ?? 0 }));
  return {
    ...base,
    channels: stored.channels ?? base.channels,
    routing: stored.routing ? { ...base.routing, ...stored.routing } : base.routing,
    retention,
    storage: { usedBytes: usage.fileBytes, totalBytes: diskBytes(ctx.store.path) ?? base.storage.totalBytes },
  };
}

/** Throws (→ 400) on a retention value that is not one of its options or not a duration. */
export function updateSettings(ctx: Ctx, patch: SettingsPatch): void {
  const current = settings(ctx);
  if (patch.retention) {
    for (const r of patch.retention) {
      const known = current.retention.find((x) => x.id === r.id);
      if (!known) throw new Error(`unknown retention kind "${r.id}"`);
      if (!known.options.includes(r.current)) throw new Error(`retention for ${r.id} must be one of ${known.options.join(', ')}`);
      parseDuration(r.current);
    }
  }
  const stored = ctx.store.get<SettingsPatch>(KEY) ?? {};
  ctx.store.set(KEY, {
    ...stored,
    ...(patch.channels ? { channels: patch.channels } : {}),
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
