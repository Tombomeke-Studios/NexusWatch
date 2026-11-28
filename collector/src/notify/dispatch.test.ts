import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import type { Fetch } from '../sources/types.js';
import { Store } from '../store.js';
import { createCtx } from '../views/ctx.js';
import { updateSettings } from '../views/settings.js';
import { acknowledge, rules } from '../views/alerts.js';
import { sample } from '../sample.js';
import { MAX_ATTEMPTS, channelsFor, notifyOnce, testChannel } from './dispatch.js';

const ENV = {
  // A health target makes the collector "live": only then are incidents real.
  NW_HEALTH_TARGETS: JSON.stringify([{ id: 'fv-invoice-service', name: 'invoice-service', project: 'finvault', url: 'http://fv:8003/health' }]),
  NW_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/secret-abcd',
  NW_NTFY_URL: 'https://ntfy.sh/topic-wxyz',
  NW_PUBLIC_URL: 'https://watch.example.org/',
};

function setup(env: Record<string, string> = ENV, answer: (url: string) => Response = () => new Response('{}')) {
  let now = Date.UTC(2026, 0, 1, 12);
  const store = new Store();
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init?.body as string) as Record<string, unknown> });
    return answer(url);
  };
  const ctx = createCtx(store, loadConfig(env), { clock: () => now, fetch });
  const open = (severity: 'critical' | 'warning' | 'info' = 'critical') =>
    store.openIncident({ subject: 'service:fv-invoice-service', project: 'finvault', severity, title: 'invoice-service is not responding', note: 'ECONNREFUSED', startedAt: now });
  return { ctx, store, calls, open, tick: (ms: number) => (now += ms), close: () => store.closeIncidents('service:fv-invoice-service', now) };
}

const ALL = { from: 0, to: Number.MAX_SAFE_INTEGER };

const titles = (calls: { body: Record<string, unknown> }[]) =>
  calls.map((c) => (c.body.title as string | undefined) ?? (c.body.embeds as { title: string }[])[0].title);

describe('notifyOnce', () => {
  it('notifies every routed channel once when an incident opens', async () => {
    const t = setup();
    t.open();
    await notifyOnce(t.ctx);
    await notifyOnce(t.ctx);
    expect(t.calls.map((c) => new URL(c.url).host).sort()).toEqual(['discord.com', 'ntfy.sh']);
    expect(titles(t.calls)).toEqual(['[CRITICAL] invoice-service is not responding', '[CRITICAL] invoice-service is not responding']);
    const log = t.store.logs(ALL).map((l) => l.message);
    expect(log).toContain('Notified discord: invoice-service is not responding');
  });

  it('sends the all-clear when the incident closes, then forgets it', async () => {
    const t = setup();
    t.open();
    await notifyOnce(t.ctx);
    t.tick(7 * 60_000);
    t.close();
    await notifyOnce(t.ctx);
    await notifyOnce(t.ctx);
    expect(titles(t.calls.slice(2))).toEqual(['[RESOLVED] invoice-service is not responding', '[RESOLVED] invoice-service is not responding']);
    expect(JSON.stringify(t.calls[2].body)).toContain('Recovered after 7 min.');
    expect(t.store.get('notify.state')).toEqual({});
  });

  it('follows the routing and the channel switches', async () => {
    const t = setup();
    // Sample defaults route a warning to Discord and Telegram, not to push; Telegram has no target here.
    expect(channelsFor(t.ctx, 'warning')).toEqual(['discord']);
    updateSettings(t.ctx, { channels: [{ id: 'discord', enabled: false }] as never });
    expect(channelsFor(t.ctx, 'critical')).toEqual(['push']);
  });

  it("sends to the rule's own channels, minus the ones switched off", async () => {
    const t = setup();
    // A down service is rule r2 ("Service down", FinVault): Discord and push, whatever the severity.
    updateSettings(t.ctx, { channels: [{ id: 'discord', enabled: false }] as never });
    t.open('warning');
    await notifyOnce(t.ctx);
    expect(t.calls.map((c) => new URL(c.url).host)).toEqual(['ntfy.sh']);
  });

  it('falls back to the severity routing when the rule no longer exists', async () => {
    const t = setup();
    // A deleted rule's incident: Settings routes critical to Discord and push.
    t.store.openIncident({ subject: 'rule:r-gone:fv-invoice-service', project: 'finvault', severity: 'critical', title: 'Gone rule fired', note: '', startedAt: Date.UTC(2026, 0, 1, 12) });
    await notifyOnce(t.ctx);
    expect(t.calls.map((c) => new URL(c.url).host).sort()).toEqual(['discord.com', 'ntfy.sh']);
  });

  it('runs the escalation policy until someone acknowledges', async () => {
    const env = { ...ENV, NW_TELEGRAM_BOT_TOKEN: '123456:ABCdefGHIjklMNOpqrSTUvwxYZ_12345', NW_TELEGRAM_CHAT_ID: '-100123' };
    const t = setup(env);
    const r2 = rules(t.ctx).find((r) => r.id === 'r2')!;
    // Only Discord at once, Telegram after 5 min (ep_oncall), nothing else.
    sample.updateRule('r2', { ...r2, channels: ['discord'], escalationPolicyId: 'ep_oncall' });
    const i = t.open();
    await notifyOnce(t.ctx);
    expect(t.calls.map((c) => new URL(c.url).host)).toEqual(['discord.com']);
    t.tick(6 * 60_000);
    await notifyOnce(t.ctx);
    expect(t.calls.map((c) => new URL(c.url).host)).toEqual(['discord.com', 'api.telegram.org']);

    // A second incident that is acknowledged before the 5 minutes: no Telegram.
    t.close();
    await notifyOnce(t.ctx);
    const before = t.calls.length;
    const j = t.open();
    expect(j.id).not.toBe(i.id);
    acknowledge(t.ctx, j.id, 'on it');
    t.tick(6 * 60_000);
    await notifyOnce(t.ctx);
    expect(t.calls.slice(before).map((c) => new URL(c.url).host)).toEqual(['discord.com']);
    sample.updateRule('r2', r2);
  });

  it('retries a channel that failed, and gives up after the last attempt', async () => {
    let discordUp = false;
    const t = setup(ENV, (url) => (url.includes('discord') && !discordUp ? new Response('{}', { status: 502 }) : new Response('{}')));
    t.open();
    await notifyOnce(t.ctx);
    expect(t.calls).toHaveLength(2);
    discordUp = true;
    await notifyOnce(t.ctx);
    // Only Discord was still owed a message.
    expect(t.calls.slice(2).map((c) => new URL(c.url).host)).toEqual(['discord.com']);

    const down = setup(ENV, () => new Response('{}', { status: 500 }));
    down.open();
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) await notifyOnce(down.ctx);
    expect(down.calls).toHaveLength(MAX_ATTEMPTS * 2);
    const failures = down.store.logs(ALL).filter((l) => l.message.includes('failed'));
    expect(failures.some((l) => l.level === 'error' && l.message.includes('giving up'))).toBe(true);
    // First and last attempt per channel, not one line per retry.
    expect(failures).toHaveLength(4);
  });

  it('does not repeat a notification after a restart', async () => {
    const t = setup();
    t.open();
    await notifyOnce(t.ctx);
    const again = createCtx(t.store, loadConfig(ENV), { fetch: async () => { throw new Error('must not send'); } });
    await notifyOnce(again);
    expect(t.calls).toHaveLength(2);
  });

  it('sends nothing for sample data', async () => {
    const { NW_HEALTH_TARGETS: _live, ...sampleOnly } = ENV;
    void _live;
    const t = setup(sampleOnly);
    t.open();
    await notifyOnce(t.ctx);
    expect(t.calls).toHaveLength(0);
  });
});

describe('testChannel', () => {
  it('delivers through a configured channel even when it is switched off', async () => {
    const t = setup();
    updateSettings(t.ctx, { channels: [{ id: 'discord', enabled: false }] as never });
    expect(await testChannel(t.ctx, 'discord')).toEqual({ ok: true, detail: 'Delivered' });
    expect(titles(t.calls)).toEqual(['[TEST] Test notification from NexusWatch']);
  });

  it('explains a channel without a target, and knows which channels exist', async () => {
    const t = setup();
    expect(await testChannel(t.ctx, 'telegram')).toEqual({ ok: false, detail: expect.stringContaining('NW_TELEGRAM_BOT_TOKEN') });
    expect(await testChannel(t.ctx, 'carrier-pigeon')).toBeNull();
    expect(t.calls).toHaveLength(0);
  });
});
