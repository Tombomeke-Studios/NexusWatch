/**
 * Notification channel setup, pure: which fields each channel needs, and the one validator the
 * Settings form, the sample backend and the collector all use.
 *
 * Targets are secrets and the collector calls them, so the rules are strict: Discord only at
 * discord.com, Telegram only through its bot API (no URL at all), and ntfy / SMTP never at a loopback,
 * link-local or cloud-metadata address (the LAN is allowed: self-hosted ntfy and mail are common).
 */
import type { ChannelId } from '@/api/types';

/** What each channel sends to, once validated (the collector's `NotifyTargets` shape). */
export interface ChannelTargets {
  discord: { url: string };
  telegram: { token: string; chatId: string };
  push: { server: string; topic: string; token: string | undefined };
  email: { smtpUrl: string; from: string; to: string };
}

export type ChannelConfigInput = Record<string, string | undefined>;

export type ChannelValidation<K extends ChannelId = ChannelId> =
  | { ok: true; target: ChannelTargets[K] }
  | { ok: false; field: string; error: string };

export interface ChannelField {
  name: string;
  label: string;
  placeholder: string;
  /** Shown as a password field; never shown back. */
  secret: boolean;
  optional?: boolean;
  help?: string;
}

export const CHANNEL_FIELDS: Record<ChannelId, ChannelField[]> = {
  discord: [
    { name: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/…', secret: true, help: 'Server settings → Integrations → Webhooks → New webhook → Copy webhook URL.' },
  ],
  telegram: [
    { name: 'botToken', label: 'Bot token', placeholder: '123456:ABC-DEF…', secret: true, help: 'From @BotFather (/newbot). Add the bot to your group or channel.' },
    { name: 'chatId', label: 'Chat id', placeholder: '-1001234567890 or @channel', secret: false, help: 'A user, group (negative) or @channel the bot may write to.' },
  ],
  push: [
    { name: 'url', label: 'Server and topic', placeholder: 'https://ntfy.sh/my-secret-topic', secret: true, help: 'Subscribe to the same topic in the ntfy app.' },
    { name: 'token', label: 'Access token', placeholder: 'only for a protected topic', secret: true, optional: true },
  ],
  email: [
    { name: 'smtpUrl', label: 'SMTP server', placeholder: 'smtps://user:password@mail.example.org:465', secret: true },
    { name: 'from', label: 'From', placeholder: 'nexuswatch@example.org', secret: false },
    { name: 'to', label: 'To', placeholder: 'you@example.org', secret: false },
  ],
};

const tail = (secret: string) => `••••${secret.slice(-4)}`;

/** What Settings shows for a configured channel: enough to recognise it, never enough to use it. */
export function maskChannelTarget<K extends ChannelId>(id: K, target: ChannelTargets[K]): string {
  switch (id) {
    case 'discord':
      return `${new URL((target as ChannelTargets['discord']).url).host}/api/webhooks/${tail((target as ChannelTargets['discord']).url)}`;
    case 'telegram': {
      const t = target as ChannelTargets['telegram'];
      return `chat ${t.chatId} via bot ${tail(t.token)}`;
    }
    case 'push': {
      const t = target as ChannelTargets['push'];
      return `${new URL(t.server).host}/${tail(t.topic)}`;
    }
    default:
      return (target as ChannelTargets['email']).to;
  }
}

const fail = (field: string, error: string) => ({ ok: false as const, field, error });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Hosts the collector must never be asked to call: loopback, "this host", link-local, cloud metadata. */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === 'metadata.google.internal' || h === 'metadata') return true;
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('::ffff:127.')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 0 || (a === 169 && b === 254);
  }
  return false;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function validateChannelConfig<K extends ChannelId>(id: K, input: ChannelConfigInput): ChannelValidation<K>;
export function validateChannelConfig(id: ChannelId, input: ChannelConfigInput): ChannelValidation {
  const v = (name: string) => (input[name] ?? '').trim();
  switch (id) {
    case 'discord': {
      const url = parseUrl(v('webhookUrl'));
      const host = url?.hostname ?? '';
      if (!url || url.protocol !== 'https:' || !(host === 'discord.com' || host === 'discordapp.com' || host.endsWith('.discord.com')) || !url.pathname.startsWith('/api/webhooks/')) {
        return fail('webhookUrl', 'Must look like https://discord.com/api/webhooks/<id>/<token>');
      }
      return { ok: true, target: { url: url.toString() } };
    }
    case 'telegram': {
      const token = v('botToken');
      const chatId = v('chatId');
      if (!/^\d+:[\w-]{20,}$/.test(token)) return fail('botToken', 'Must look like 123456:ABC-DEF… (from @BotFather)');
      if (!/^-?\d+$/.test(chatId) && !/^@[A-Za-z][\w]{3,}$/.test(chatId)) return fail('chatId', 'A number (groups are negative) or @channelname');
      return { ok: true, target: { token, chatId } };
    }
    case 'push': {
      const url = parseUrl(v('url'));
      if (!url || !/^https?:$/.test(url.protocol)) return fail('url', 'Must be the server plus a topic, e.g. https://ntfy.sh/my-topic');
      if (isBlockedHost(url.hostname)) return fail('url', 'A local or metadata address is not allowed');
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length !== 1) return fail('url', 'Must be the server plus one topic, e.g. https://ntfy.sh/my-topic');
      return { ok: true, target: { server: `${url.origin}/`, topic: decodeURIComponent(segments[0]), token: v('token') || undefined } };
    }
    case 'email': {
      const url = parseUrl(v('smtpUrl'));
      if (!url || !/^smtps?:$/.test(url.protocol) || !url.hostname) return fail('smtpUrl', 'Must start with smtp:// or smtps://');
      if (isBlockedHost(url.hostname)) return fail('smtpUrl', 'A local or metadata address is not allowed');
      if (!EMAIL.test(v('from'))) return fail('from', 'Not an email address');
      if (!EMAIL.test(v('to'))) return fail('to', 'Not an email address');
      return { ok: true, target: { smtpUrl: v('smtpUrl'), from: v('from'), to: v('to') } };
    }
  }
}
