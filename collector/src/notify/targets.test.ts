import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { Store } from '../store.js';
import { createCtx } from '../views/ctx.js';
import { settings } from '../views/settings.js';
import { testChannel } from './dispatch.js';
import { configureChannel, effectiveTargets, removeChannel, targetSource } from './targets.js';

const TOKEN = '123456:ABCdefGHIjklMNOpqrSTUvwxYZ_12345';

function ctxWith(env: Record<string, string> = {}) {
  const calls: { url: string; body: string }[] = [];
  const ctx = createCtx(new Store(), loadConfig({ NW_HEALTH_TARGETS: '[]', ...env }), {
    clock: () => 0,
    fetch: async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response('{}');
    },
  });
  return { ctx, calls };
}

describe('notification targets from Settings', () => {
  it('stores a valid target, masks it everywhere and sends through it', async () => {
    const { ctx, calls } = ctxWith();
    configureChannel(ctx, 'telegram', { botToken: TOKEN, chatId: '-100123' });
    expect(targetSource(ctx, 'telegram')).toBe('settings');
    const channel = settings(ctx).channels.find((c) => c.id === 'telegram')!;
    expect(channel).toMatchObject({ configured: true, source: 'settings', enabled: true, target: 'chat -100123 via bot ••••2345' });
    expect(JSON.stringify(settings(ctx))).not.toContain('ABCdefGHI');
    expect(await testChannel(ctx, 'telegram')).toEqual({ ok: true, detail: 'Delivered' });
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
  });

  it('refuses an invalid field (422), an unknown channel (404) and a local ntfy server (422)', () => {
    const { ctx } = ctxWith();
    expect(() => configureChannel(ctx, 'discord', { webhookUrl: 'https://evil.example/api/webhooks/1/a' })).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => configureChannel(ctx, 'push', { url: 'http://127.0.0.1/topic' })).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => configureChannel(ctx, 'fax', {})).toThrow(expect.objectContaining({ status: 404 }));
    expect(effectiveTargets(ctx).discord).toBeNull();
  });

  it('lets a variable win: it cannot be changed or removed here (409)', () => {
    const { ctx } = ctxWith({ NW_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/envtoken' });
    expect(targetSource(ctx, 'discord')).toBe('env');
    expect(() => configureChannel(ctx, 'discord', { webhookUrl: 'https://discord.com/api/webhooks/2/other' })).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => removeChannel(ctx, 'discord')).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('forgets a Settings target', () => {
    const { ctx } = ctxWith();
    configureChannel(ctx, 'push', { url: 'https://ntfy.sh/my-topic' });
    removeChannel(ctx, 'push');
    expect(settings(ctx).channels.find((c) => c.id === 'push')).toMatchObject({ configured: false, source: null, enabled: false });
  });
});
