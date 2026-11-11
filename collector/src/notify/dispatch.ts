/**
 * Delivers a notification when an incident opens, escalates it while nobody acknowledges it, and
 * sends the all-clear when it closes.
 *
 * It is a periodic task rather than a hook in the sources: it compares the incidents in the store
 * with what it already sent (kept in the store too), so a restart neither repeats nor forgets a
 * notification, and a channel that was down is retried on the next run — up to MAX_ATTEMPTS.
 *
 * Which channels an open incident is owed at a given moment:
 *  - the channels its severity is routed to (Settings), from the start;
 *  - plus the steps of its rule's escalation policy that have come due. `escalationProgress` from
 *    lib/rules.ts decides that — the same function the dashboard draws the steps with — so a step
 *    is skipped once the alert is acknowledged.
 * A channel never gets the same message twice, however many reasons there are to send it.
 *
 * Only real incidents are notified: with no live source the alerts are sample data.
 */
import { escalationProgress } from '../../../dashboard/src/lib/rules.js';
import type { ChannelId, ChannelTestResult } from '../contract.js';
import type { Task } from '../sources/types.js';
import type { IncidentRow } from '../store.js';
import { acknowledgedAt, alertTarget, rules, suppression, suppressors } from '../views/alerts.js';
import { DAY_MS, iso, type Ctx } from '../views/ctx.js';
import { settings } from '../views/settings.js';
import { CHANNEL_IDS, send, type Message } from './channels.js';

const STATE = 'notify.state';
export const MAX_ATTEMPTS = 5;

interface Progress {
  sent: ChannelId[];
  /** Failed or successful tries per channel; a channel is given up on at MAX_ATTEMPTS. */
  attempts: Partial<Record<ChannelId, number>>;
}

/** Per incident id: which channels got the "firing" message, and later the "resolved" one. */
type State = Record<string, { firing: Progress; resolved?: Progress }>;

const blank = (): Progress => ({ sent: [], attempts: {} });

/** State written before attempts were counted per channel had one number for all of them. */
function readState(ctx: Ctx): State {
  const state = ctx.store.get<State>(STATE) ?? {};
  for (const entry of Object.values(state)) {
    for (const p of [entry.firing, entry.resolved]) if (p && typeof p.attempts !== 'object') p.attempts = {};
  }
  return state;
}

/** The channels that are switched on and have a target. */
function usable(ctx: Ctx): { channels: Set<ChannelId>; routing: ReturnType<typeof settings>['routing'] } {
  const s = settings(ctx);
  return { channels: new Set(s.channels.filter((c) => c.enabled && c.configured).map((c) => c.id)), routing: s.routing };
}

/** Channels a severity is routed to, that are switched on and have a target. */
export function channelsFor(ctx: Ctx, severity: IncidentRow['severity']): ChannelId[] {
  const { channels, routing } = usable(ctx);
  return [...channels].filter((c) => routing[severity]?.[c]);
}

/** The escalation steps of the incident's rule that have come due, as channels. */
export function escalatedChannels(ctx: Ctx, i: IncidentRow): ChannelId[] {
  const rule = rules(ctx).find((r) => r.id === alertTarget(i).ruleId);
  const policy = rule?.escalationPolicyId ? ctx.sample.alerts().policies.find((p) => p.id === rule.escalationPolicyId) : undefined;
  if (!policy) return [];
  const ackedAt = acknowledgedAt(ctx, i.id);
  const progress = escalationProgress(policy, {
    elapsedSeconds: Math.max(0, (ctx.clock() - i.startedAt) / 1000),
    acknowledgedAfterSeconds: ackedAt === null ? null : Math.max(0, (ackedAt - i.startedAt) / 1000),
    // Silences and maintenance hold the whole incident before this is asked (see notifyOnce).
    silenced: false,
    inMaintenance: false,
  });
  const { channels } = usable(ctx);
  return progress.filter((p) => p.state === 'sent' && channels.has(p.step.channel)).map((p) => p.step.channel);
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

const givenUp = (p: Progress, c: ChannelId) => (p.attempts[c] ?? 0) >= MAX_ATTEMPTS;

/** Tries each channel still owed a message; records the successes and one attempt per channel. */
async function deliver(ctx: Ctx, i: IncidentRow, kind: 'firing' | 'resolved', channels: ChannelId[], progress: Progress): Promise<void> {
  const owed = [...new Set(channels)].filter((c) => !progress.sent.includes(c) && !givenUp(progress, c));
  if (owed.length === 0) return;
  const m = message(ctx, i, kind);
  await Promise.all(
    owed.map(async (channel) => {
      const attempt = (progress.attempts[channel] = (progress.attempts[channel] ?? 0) + 1);
      const result = await send(channel, ctx.config.notify.targets, m, ctx.notify);
      if (result.ok) progress.sent.push(channel);
      const last = attempt >= MAX_ATTEMPTS;
      // One line per delivery, and per failure only on the first and the last attempt.
      if (result.ok || attempt === 1 || last) {
        ctx.store.addLog({
          ts: ctx.clock(),
          level: result.ok ? 'info' : last ? 'error' : 'warn',
          service: 'collector',
          project: i.project,
          node: ctx.config.host.name,
          message: result.ok
            ? `Notified ${channel}: ${m.title}${kind === 'resolved' ? ' (resolved)' : ''}`
            : `Notification to ${channel} failed${last ? ', giving up' : ', will retry'}: ${result.error}`,
          fields: { channel, incident: i.id, kind, attempt },
        });
      }
    }),
  );
}

const settled = (p: Progress, channels: ChannelId[]) => channels.every((c) => p.sent.includes(c) || givenUp(p, c));

/** One pass over the incidents. Exported for tests; `notifyTask` runs it on an interval. */
export async function notifyOnce(ctx: Ctx): Promise<void> {
  if (!ctx.live.logs) return;
  const now = ctx.clock();
  const state = readState(ctx);
  const known = new Map(ctx.store.incidents(now - 90 * DAY_MS).map((i) => [i.id, i]));

  const by = suppressors(ctx);
  for (const i of known.values()) {
    if (i.endedAt !== null) continue;
    const entry = (state[i.id] ??= { firing: blank() });
    // Held, not dropped: if the alert is still open when the silence or window ends, it is sent then.
    const held = suppression(ctx, i, by);
    if (held.silenceId || held.maintenanceId) continue;
    await deliver(ctx, i, 'firing', [...channelsFor(ctx, i.severity), ...escalatedChannels(ctx, i)], entry.firing);
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
    const progress = (entry.resolved ??= blank());
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
