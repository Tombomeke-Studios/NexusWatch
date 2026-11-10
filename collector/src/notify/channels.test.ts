import { describe, expect, it } from 'vitest';
import type { Fetch } from '../sources/types.js';
import { maskTarget, send, type Mailer, type Message, type NotifyDeps, type NotifyTargets } from './channels.js';

const WEBHOOK = 'https://discord.com/api/webhooks/123456/super-secret-token-a1b2';
const targets: NotifyTargets = {
  discord: { url: WEBHOOK },
  telegram: { token: '777:bot-secret-9xyz', chatId: '-100200300' },
  push: { server: 'https://ntfy.example.org/', topic: 'home-alerts-k3y9', token: 'tk_secret' },
  email: { smtpUrl: 'smtp://user:pass@mail.example.org:587', from: 'watch@example.org', to: 'tom@example.org' },
};
const none: NotifyTargets = { discord: null, telegram: null, push: null, email: null };

const firing: Message = { kind: 'firing', severity: 'critical', title: 'invoice-service is not responding', body: 'ECONNREFUSED on :8003', url: 'https://watch.example.org/alerts' };

interface Call { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function deps(answer: () => Response = () => new Response('{}'), mail: Mailer | null = null): NotifyDeps & { calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(init?.body as string) as Record<string, unknown> });
    return answer();
  };
  return { fetch, mail, timeoutMs: 1000, calls };
}

describe('channel senders', () => {
  it('posts a Discord embed to the webhook', async () => {
    const d = deps();
    expect(await send('discord', targets, firing, d)).toEqual({ ok: true });
    expect(d.calls[0].url).toBe(WEBHOOK);
    const [embed] = d.calls[0].body.embeds as { title: string; description: string; url: string }[];
    expect(embed.title).toBe('[CRITICAL] invoice-service is not responding');
    expect(embed.description).toBe('ECONNREFUSED on :8003');
    expect(embed.url).toBe(firing.url);
  });

  it('calls the Telegram Bot API sendMessage with the chat id', async () => {
    const d = deps();
    await send('telegram', targets, firing, d);
    expect(d.calls[0].url).toBe('https://api.telegram.org/bot777:bot-secret-9xyz/sendMessage');
    expect(d.calls[0].body.chat_id).toBe('-100200300');
    expect(d.calls[0].body.text).toContain('[CRITICAL] invoice-service is not responding');
  });

  it('publishes to ntfy as JSON with a priority per severity and the access token', async () => {
    const d = deps();
    await send('push', targets, firing, d);
    await send('push', targets, { ...firing, kind: 'resolved' }, d);
    expect(d.calls[0].url).toBe('https://ntfy.example.org/');
    expect(d.calls[0].body).toMatchObject({ topic: 'home-alerts-k3y9', priority: 5, click: firing.url });
    expect(d.calls[0].headers.Authorization).toBe('Bearer tk_secret');
    expect(d.calls[1].body).toMatchObject({ priority: 3, title: '[RESOLVED] invoice-service is not responding' });
  });

  it('hands an email to the mailer', async () => {
    const sent: Parameters<Mailer>[0][] = [];
    const d = deps(undefined, async (mail) => void sent.push(mail));
    expect(await send('email', targets, firing, d)).toEqual({ ok: true });
    expect(sent[0]).toMatchObject({ from: 'watch@example.org', to: 'tom@example.org', subject: '[CRITICAL] invoice-service is not responding' });
    expect(sent[0].text).toContain('https://watch.example.org/alerts');
  });

  it('says which variable to set when a channel is not configured, and sends nothing', async () => {
    const d = deps();
    const result = await send('discord', none, firing, d);
    expect(result).toEqual({ ok: false, error: expect.stringContaining('NW_DISCORD_WEBHOOK_URL') });
    expect(d.calls).toHaveLength(0);
  });

  it('reports the status and the reason of a refused message', async () => {
    const d = deps(() => new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 }));
    expect(await send('telegram', targets, firing, d)).toEqual({ ok: false, error: 'HTTP 400 Bad Request: chat not found' });
  });

  it('never lets a secret out through an error message', async () => {
    const failing: NotifyDeps = {
      fetch: async (url) => {
        throw new Error(`request to ${url} failed`);
      },
      mail: async () => {
        throw new Error(`cannot log in at ${targets.email!.smtpUrl}`);
      },
      timeoutMs: 1000,
    };
    for (const id of ['discord', 'telegram', 'push', 'email'] as const) {
      const result = await send(id, targets, firing, failing);
      expect(result.ok).toBe(false);
      const error = (result as { error: string }).error;
      for (const secret of [WEBHOOK, 'bot-secret-9xyz', 'home-alerts-k3y9', 'tk_secret', 'user:pass']) expect(error).not.toContain(secret);
    }
  });

  it('reports a timeout as such', async () => {
    const d: NotifyDeps = { fetch: async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }, mail: null, timeoutMs: 1 };
    expect(await send('discord', targets, firing, d)).toEqual({ ok: false, error: 'timed out' });
  });
});

describe('maskTarget', () => {
  it('shows enough to recognise a target and never the secret', () => {
    expect(maskTarget('discord', targets)).toBe('discord.com/api/webhooks/••••a1b2');
    expect(maskTarget('telegram', targets)).toBe('chat -100200300 via bot ••••9xyz');
    expect(maskTarget('push', targets)).toBe('ntfy.example.org/••••k3y9');
    expect(maskTarget('email', targets)).toBe('tom@example.org');
    for (const id of ['discord', 'telegram', 'push', 'email'] as const) expect(maskTarget(id, none)).toBeNull();
  });
});
