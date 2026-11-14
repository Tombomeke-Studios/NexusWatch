import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import type { Fetch } from '../sources/types.js';
import { Store } from '../store.js';
import { createCtx } from '../views/ctx.js';
import { acknowledge, alerts } from '../views/alerts.js';
import { updateSettings } from '../views/settings.js';
import { MAX_ATTEMPTS, channelsFor, escalatedChannels, notifyOnce, testChannel } from './dispatch.js';

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
    t.open('warning');
    await notifyOnce(t.ctx);
    expect(t.calls).toHaveLength(0);
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

// A warning on a FinVault service: routed to Discord only, and its rule (r2, "Service down") escalates
// through the On-call policy — Discord at once, Telegram after 5 min (no target here), push after 15 min.
describe('escalation', () => {
  const hosts = (calls: { url: string }[]) => calls.map((c) => new URL(c.url).host);
  const MIN = 60_000;

  it('adds a policy step when it comes due, once', async () => {
    const t = setup();
    t.open('warning');
    await notifyOnce(t.ctx);
    expect(hosts(t.calls)).toEqual(['discord.com']);

    t.tick(14 * MIN);
    await notifyOnce(t.ctx);
    expect(t.calls).toHaveLength(1);

    t.tick(1 * MIN);
    await notifyOnce(t.ctx);
    await notifyOnce(t.ctx);
    expect(hosts(t.calls)).toEqual(['discord.com', 'ntfy.sh']);
    expect(titles(t.calls)[1]).toBe('[WARNING] invoice-service is not responding');
  });

  it('skips the steps that were not due yet when the alert is acknowledged', async () => {
    const t = setup();
    const incident = t.open('warning');
    await notifyOnce(t.ctx);
    t.tick(10 * MIN);
    acknowledge(t.ctx, incident.id, 'Restarting it');
    t.tick(30 * MIN);
    await notifyOnce(t.ctx);
    expect(hosts(t.calls)).toEqual(['discord.com']);
  });

  it('still delivers a step that was due before the acknowledgement', async () => {
    const t = setup(ENV, (url) => (url.includes('ntfy') ? new Response('{}', { status: 503 }) : new Response('{}')));
    const incident = t.open('warning');
    t.tick(16 * MIN);
    await notifyOnce(t.ctx);
    // Push was due and failed; acknowledging afterwards does not cancel the retry.
    acknowledge(t.ctx, incident.id);
    await notifyOnce(t.ctx);
    expect(hosts(t.calls)).toEqual(['discord.com', 'ntfy.sh', 'ntfy.sh']);
  });

  it('sends the all-clear to every channel the alarm reached, escalated ones included', async () => {
    const t = setup();
    t.open('warning');
    t.tick(15 * MIN);
    await notifyOnce(t.ctx);
    t.close();
    await notifyOnce(t.ctx);
    expect(titles(t.calls.slice(2)).sort()).toEqual(['[RESOLVED] invoice-service is not responding', '[RESOLVED] invoice-service is not responding']);
  });

  it('does not escalate through a channel that is switched off', async () => {
    const t = setup();
    updateSettings(t.ctx, { channels: [{ id: 'push', enabled: false }] as never });
    expect(escalatedChannels(t.ctx, t.open('warning'))).toEqual(['discord']);
    t.tick(20 * MIN);
    await notifyOnce(t.ctx);
    expect(hosts(t.calls)).toEqual(['discord.com']);
  });

  it('gives up on one channel without holding back a later step', async () => {
    const t = setup(ENV, (url) => (url.includes('discord') ? new Response('{}', { status: 500 }) : new Response('{}')));
    t.open('warning');
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await notifyOnce(t.ctx);
    expect(t.calls).toHaveLength(MAX_ATTEMPTS);
    t.tick(15 * MIN);
    await notifyOnce(t.ctx);
    expect(hosts(t.calls).at(-1)).toBe('ntfy.sh');
  });

  it('reads delivery state written before attempts were counted per channel', async () => {
    const t = setup();
    const incident = t.open('warning');
    t.store.set('notify.state', { [incident.id]: { firing: { sent: ['discord'], attempts: 1 } } });
    await notifyOnce(t.ctx);
    expect(t.calls).toHaveLength(0);
  });
});

describe('acknowledging a live alert', () => {
  it('keeps the time and the note of the first acknowledgement, and refuses an alert that is not open', () => {
    const t = setup();
    const incident = t.open('warning');
    t.tick(3 * 60_000);
    acknowledge(t.ctx, incident.id, ' On it ');
    t.tick(60_000);
    acknowledge(t.ctx, incident.id, 'Again');
    const a = alerts(t.ctx);
    const alert = a.active.find((x) => x.id === incident.id)!;
    expect(alert.acknowledged).toBe(true);
    expect(Date.parse(alert.acknowledgedAt!) - incident.startedAt).toBe(3 * 60_000);
    expect(alert.notes).toMatchObject([{ kind: 'acknowledged', text: 'On it' }]);
    expect(a.history.find((h) => h.id === incident.id)?.notes).toHaveLength(1);
    expect(() => acknowledge(t.ctx, 'inc_nope')).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('still reads acknowledgements stored as a plain list of ids', () => {
    const t = setup();
    const incident = t.open('warning');
    t.store.set('alerts.acknowledged', [incident.id]);
    const alert = alerts(t.ctx).active.find((x) => x.id === incident.id)!;
    expect(alert).toMatchObject({ acknowledged: true, acknowledgedAt: null, notes: [] });
  });
});
