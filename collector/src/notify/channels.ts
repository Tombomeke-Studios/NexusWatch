/**
 * One sender per notification channel. Where a channel sends to is collector configuration
 * (`NW_*` variables), never something the API accepts: the targets are secrets, and an endpoint
 * that takes a URL to call would let anyone who reaches the API make the collector call it.
 *
 * Senders throw on failure with a text that never contains the target (no URL, token or topic).
 */
import type { ChannelId, Severity } from '../contract.js';
import { errorText, type Fetch } from '../sources/types.js';

export interface NotifyTargets {
  discord: { url: string } | null;
  telegram: { token: string; chatId: string } | null;
  /** ntfy: the server and the topic, split so the message can be published as JSON. */
  push: { server: string; topic: string; token: string | undefined } | null;
  email: { smtpUrl: string; from: string; to: string } | null;
}

export interface Message {
  kind: 'firing' | 'resolved' | 'test';
  severity: Severity;
  title: string;
  body: string;
  /** Link back to the dashboard, when `NW_PUBLIC_URL` is set. */
  url: string | null;
}

export type Mailer = (mail: { from: string; to: string; subject: string; text: string }) => Promise<void>;

export interface NotifyDeps {
  fetch: Fetch;
  /** Null when no SMTP server is configured. */
  mail: Mailer | null;
  timeoutMs: number;
}

export type SendResult = { ok: true } | { ok: false; error: string };

export const CHANNEL_IDS: ChannelId[] = ['discord', 'telegram', 'email', 'push'];

/** The variable(s) that turn a channel on — shown in Settings while it is off. */
export const CHANNEL_VARIABLES: Record<ChannelId, string> = {
  discord: 'NW_DISCORD_WEBHOOK_URL',
  telegram: 'NW_TELEGRAM_BOT_TOKEN and NW_TELEGRAM_CHAT_ID',
  email: 'NW_SMTP_URL, NW_EMAIL_FROM and NW_EMAIL_TO',
  push: 'NW_NTFY_URL',
};

const tail = (secret: string) => `••••${secret.slice(-4)}`;

/** What Settings shows for a configured channel: enough to recognise it, never enough to use it. */
export function maskTarget(id: ChannelId, t: NotifyTargets): string | null {
  switch (id) {
    case 'discord':
      return t.discord && `${new URL(t.discord.url).host}/api/webhooks/${tail(t.discord.url)}`;
    case 'telegram':
      return t.telegram && `chat ${t.telegram.chatId} via bot ${tail(t.telegram.token)}`;
    case 'push':
      return t.push && `${new URL(t.push.server).host}/${tail(t.push.topic)}`;
    case 'email':
      return t.email && t.email.to;
  }
}

const LABEL: Record<Message['kind'], string> = { firing: 'ALERT', resolved: 'RESOLVED', test: 'TEST' };
const heading = (m: Message) => `[${m.kind === 'firing' ? m.severity.toUpperCase() : LABEL[m.kind]}] ${m.title}`;
const text = (m: Message) => [heading(m), m.body, m.url].filter(Boolean).join('\n');

// Colour of the Discord embed's side bar, and ntfy's priority (1–5), per severity.
const DISCORD_COLOR: Record<Severity, number> = { critical: 0xef4444, warning: 0xf59e0b, info: 0x6366f1 };
const RESOLVED_COLOR = 0x10b981;
const NTFY_PRIORITY: Record<Severity, number> = { critical: 5, warning: 4, info: 3 };

async function post(deps: NotifyDeps, url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(deps.timeoutMs),
  });
  if (res.ok) return;
  // Discord answers { message }, Telegram { description }, ntfy { error }: say why, briefly.
  let reason = '';
  try {
    const answer = (await res.json()) as { message?: unknown; description?: unknown; error?: unknown };
    const said = answer.message ?? answer.description ?? answer.error;
    if (typeof said === 'string') reason = ` ${said.slice(0, 120)}`;
  } catch {
    // No JSON body: the status says enough.
  }
  throw new Error(`HTTP ${res.status}${reason}`);
}

const senders: { [K in ChannelId]: (target: NonNullable<NotifyTargets[K]>, m: Message, deps: NotifyDeps) => Promise<void> } = {
  discord: (target, m, deps) =>
    post(deps, target.url, {
      username: 'NexusWatch',
      embeds: [{ title: heading(m), description: m.body, color: m.kind === 'resolved' ? RESOLVED_COLOR : DISCORD_COLOR[m.severity], ...(m.url ? { url: m.url } : {}) }],
    }),
  telegram: (target, m, deps) =>
    post(deps, `https://api.telegram.org/bot${target.token}/sendMessage`, { chat_id: target.chatId, text: text(m), disable_web_page_preview: true }),
  push: (target, m, deps) =>
    post(
      deps,
      target.server,
      {
        topic: target.topic,
        title: heading(m),
        message: m.body || m.title,
        priority: m.kind === 'firing' ? NTFY_PRIORITY[m.severity] : 3,
        tags: [m.kind === 'resolved' ? 'white_check_mark' : m.kind === 'test' ? 'test_tube' : 'rotating_light'],
        ...(m.url ? { click: m.url } : {}),
      },
      target.token ? { Authorization: `Bearer ${target.token}` } : {},
    ),
  email: async (target, m, deps) => {
    if (!deps.mail) throw new Error('no SMTP server configured');
    await deps.mail({ from: target.from, to: target.to, subject: heading(m), text: [m.body, m.url].filter(Boolean).join('\n\n') || m.title });
  },
};

/** Sends one message through one channel. Never throws: a failure is a result. */
export async function send(id: ChannelId, targets: NotifyTargets, m: Message, deps: NotifyDeps): Promise<SendResult> {
  const target = targets[id];
  if (!target) return { ok: false, error: `not configured — set ${CHANNEL_VARIABLES[id]} on the collector` };
  try {
    await (senders[id] as (t: typeof target, m: Message, deps: NotifyDeps) => Promise<void>)(target, m, deps);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: scrub(errorText(err), targets) };
  }
}

/** Belt and braces: whatever a library put in its error, no configured secret leaves in it. */
function scrub(message: string, t: NotifyTargets): string {
  const secrets = [t.discord?.url, t.telegram?.token, t.push?.topic, t.push?.token, t.email?.smtpUrl].filter((s): s is string => !!s);
  return secrets.reduce((out, s) => out.split(s).join('••••'), message);
}
