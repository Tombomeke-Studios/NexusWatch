/**
 * Where each notification channel sends to: the collector's NW_* variables first (they win and are
 * never changed through the API), then what was entered on the Settings page.
 *
 * Settings targets are write-only: stored in SQLite, validated by the dashboard's own
 * `validateChannelConfig` (fixed hosts for Discord and Telegram; no loopback, link-local or metadata
 * address for ntfy and SMTP), and only ever shown masked.
 */
import { validateChannelConfig } from '@/lib/channels';
import type { ChannelId, ChannelSource } from '../contract.js';
import { HttpError } from '../routes.js';
import type { Store } from '../store.js';
import type { Ctx } from '../views/ctx.js';
import { setChannelEnabled } from '../views/settings.js';
import { CHANNEL_IDS, type NotifyTargets } from './channels.js';

export const STORED_TARGETS = 'notify.targets';

type Stored = Partial<{ [K in ChannelId]: NonNullable<NotifyTargets[K]> }>;

const stored = (store: Store): Stored => store.get<Stored>(STORED_TARGETS) ?? {};

/** Every channel's target: the variable's, else the one set up in Settings, else none. */
export function effectiveTargets(ctx: Ctx): NotifyTargets {
  const env = ctx.config.notify.targets;
  const saved = stored(ctx.store);
  return {
    discord: env.discord ?? saved.discord ?? null,
    telegram: env.telegram ?? saved.telegram ?? null,
    push: env.push ?? saved.push ?? null,
    email: env.email ?? saved.email ?? null,
  };
}

export function targetSource(ctx: Ctx, id: ChannelId): ChannelSource | null {
  if (ctx.config.notify.targets[id]) return 'env';
  return stored(ctx.store)[id] ? 'settings' : null;
}

function channelId(id: string): ChannelId {
  if (!CHANNEL_IDS.includes(id as ChannelId)) throw new HttpError(404, `Channel ${id} not found`);
  return id as ChannelId;
}

/** `PUT /settings/channels/:id`. 409 when a variable sets it, 422 when a field does not validate. */
export function configureChannel(ctx: Ctx, rawId: string, body: unknown): void {
  const id = channelId(rawId);
  if (ctx.config.notify.targets[id]) throw new HttpError(409, `${id} is set by the collector's environment (.env); change it there`);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'body must be a JSON object');
  const input = Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  const result = validateChannelConfig(id, input);
  if (!result.ok) throw new HttpError(422, `${result.field}: ${result.error}`);
  ctx.store.set(STORED_TARGETS, { ...stored(ctx.store), [id]: result.target });
  setChannelEnabled(ctx, id, true);
}

/** `DELETE /settings/channels/:id`: forgets the Settings target (a variable cannot be removed here). */
export function removeChannel(ctx: Ctx, rawId: string): void {
  const id = channelId(rawId);
  if (ctx.config.notify.targets[id]) throw new HttpError(409, `${id} is set by the collector's environment (.env); remove it there`);
  const next = { ...stored(ctx.store) };
  delete next[id];
  ctx.store.set(STORED_TARGETS, next);
}
