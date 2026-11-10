/**
 * Delivers a notification when an incident opens and again when it closes.
 *
 * It is a periodic task rather than a hook in the sources: it compares the incidents in the store
 * with what it already sent (kept in the store too), so a restart neither repeats nor forgets a
 * notification, and a channel that was down is retried on the next run — up to MAX_ATTEMPTS.
 *
 * Only real incidents are notified: with no live source the alerts are sample data.
 */
import type { ChannelId, ChannelTestResult } from '../contract.js';
import type { Task } from '../sources/types.js';
import type { IncidentRow } from '../store.js';
import { DAY_MS, iso, type Ctx } from '../views/ctx.js';
import { settings } from '../views/settings.js';
import { CHANNEL_IDS, send, type Message } from './channels.js';

const STATE = 'notify.state';
export const MAX_ATTEMPTS = 5;

interface Progress {
  sent: ChannelId[];
  attempts: number;
}

/** Per incident id: which channels got the "firing" message, and later the "resolved" one. */
type State = Record<string, { firing: Progress; resolved?: Progress }>;

/** Channels a severity is routed to, that are switched on and have a target. */
export function channelsFor(ctx: Ctx, severity: IncidentRow['severity']): ChannelId[] {
  const s = settings(ctx);
  return s.channels.filter((c) => c.enabled && c.configured && s.routing[severity]?.[c.id]).map((c) => c.id);
}

function message(ctx: Ctx, i: IncidentRow, kind: 'firing' | 'resolved'): Message {
  const minutes = Math.max(1, Math.round(((i.endedAt ?? ctx.clock()) - i.startedAt) / 60_000));
  return {
    kind,
    severity: i.severity,
    title: i.title,
    body: kind === 'firing' ? `${i.note}\nSince ${iso(i.startedAt)}`.trim() : `Recovered after ${minutes} min.`,
    url: ctx.config.notify.publicUrl ? `${ctx.config.notify.publicUrl}/alerts` : null,
  };
}

/** Tries the channels still owed a message; records the successes and one attempt. */
async function deliver(ctx: Ctx, i: IncidentRow, kind: 'firing' | 'resolved', channels: ChannelId[], progress: Progress): Promise<void> {
  const owed = channels.filter((c) => !progress.sent.includes(c));
  if (owed.length === 0 || progress.attempts >= MAX_ATTEMPTS) return;
  progress.attempts += 1;
  const m = message(ctx, i, kind);
  await Promise.all(
    owed.map(async (channel) => {
      const result = await send(channel, ctx.config.notify.targets, m, ctx.notify);
      if (result.ok) progress.sent.push(channel);
      const last = progress.attempts >= MAX_ATTEMPTS;
      // One line per delivery, and per failure only on the first and the last attempt.
      if (result.ok || progress.attempts === 1 || last) {
        ctx.store.addLog({
          ts: ctx.clock(),
          level: result.ok ? 'info' : last ? 'error' : 'warn',
          service: 'collector',
          project: i.project,
          node: ctx.config.host.name,
          message: result.ok
            ? `Notified ${channel}: ${m.title}${kind === 'resolved' ? ' (resolved)' : ''}`
            : `Notification to ${channel} failed${last ? ', giving up' : ', will retry'}: ${result.error}`,
          fields: { channel, incident: i.id, kind, attempt: progress.attempts },
        });
      }
    }),
  );
}

const settled = (p: Progress, channels: ChannelId[]) => p.attempts >= MAX_ATTEMPTS || channels.every((c) => p.sent.includes(c));

/** One pass over the incidents. Exported for tests; `notifyTask` runs it on an interval. */
export async function notifyOnce(ctx: Ctx): Promise<void> {
  if (!ctx.live.logs) return;
  const now = ctx.clock();
  const state = ctx.store.get<State>(STATE) ?? {};
  const known = new Map(ctx.store.incidents(now - 90 * DAY_MS).map((i) => [i.id, i]));

  for (const i of known.values()) {
    if (i.endedAt !== null) continue;
    const entry = (state[i.id] ??= { firing: { sent: [], attempts: 0 } });
    await deliver(ctx, i, 'firing', channelsFor(ctx, i.severity), entry.firing);
  }

  for (const [id, entry] of Object.entries(state)) {
    const i = known.get(id);
    if (!i) {
      delete state[id];
      continue;
    }
    if (i.endedAt === null) continue;
    // "Resolved" only goes where "firing" arrived: nobody needs the all-clear for an alarm they never got.
    const channels = entry.firing.sent;
    const progress = (entry.resolved ??= { sent: [], attempts: 0 });
    await deliver(ctx, i, 'resolved', channels, progress);
    if (settled(progress, channels)) delete state[id];
  }

  ctx.store.set(STATE, state);
}

export function notifyTask(ctx: Ctx): Task {
  return { name: 'notify', intervalMs: ctx.config.notify.intervalMs, run: () => notifyOnce(ctx) };
}

/** The "Send test" button: one message through one channel, whatever its switch or routing says. */
export async function testChannel(ctx: Ctx, id: string): Promise<ChannelTestResult | null> {
  if (!CHANNEL_IDS.includes(id as ChannelId)) return null;
  const result = await send(
    id as ChannelId,
    ctx.config.notify.targets,
    {
      kind: 'test',
      severity: 'info',
      title: 'Test notification from NexusWatch',
      body: `Sent from ${ctx.config.host.name}. If you can read this, the channel works.`,
      url: ctx.config.notify.publicUrl,
    },
    ctx.notify,
  );
  return result.ok ? { ok: true, detail: 'Delivered' } : { ok: false, detail: result.error };
}
