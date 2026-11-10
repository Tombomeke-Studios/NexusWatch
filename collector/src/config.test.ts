import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('turns every source off by default', () => {
    const c = loadConfig({});
    expect(c.port).toBe(8080);
    expect(c.health.targets).toEqual([]);
    expect(c.controlRoom).toBeNull();
    expect(c.metrics.targets).toEqual([]);
    expect(c.bus).toBeNull();
  });

  it('reads health targets from JSON, deriving the port and applying default timings', () => {
    const c = loadConfig({
      NW_HEALTH_INTERVAL_MS: '10000',
      NW_HEALTH_TARGETS: JSON.stringify([
        { id: 'nx-control-room', name: 'control-room', project: 'nexusinfra', url: 'http://control-room:9000/health' },
        { id: 'fv-gw', name: 'api-gateway', project: 'finvault', url: 'https://fv.example/health', timeoutMs: 2000 },
      ]),
    });
    expect(c.health.targets[0]).toMatchObject({ port: ':9000', intervalMs: 10_000, timeoutMs: 5_000 });
    expect(c.health.targets[1]).toMatchObject({ port: ':443', timeoutMs: 2_000 });
  });

  it('reads health targets from a file', () => {
    const file = JSON.stringify([{ id: 'a', name: 'a', project: 'finvault', url: 'http://a:1/health' }]);
    const c = loadConfig({ NW_HEALTH_TARGETS_FILE: 'targets.json' }, () => file);
    expect(c.health.targets).toHaveLength(1);
  });

  it('rejects broken target lists loudly', () => {
    const t = (list: object[]) => ({ NW_HEALTH_TARGETS: JSON.stringify(list) });
    expect(() => loadConfig({ NW_HEALTH_TARGETS: '{' })).toThrow(/not valid JSON/);
    expect(() => loadConfig(t([{ id: 'a', name: 'a', project: 'other', url: 'http://a/' }]))).toThrow(/project/);
    expect(() =>
      loadConfig(t([{ id: 'a', name: 'a', project: 'finvault', url: 'http://a/' }, { id: 'a', name: 'b', project: 'finvault', url: 'http://b/' }])),
    ).toThrow(/twice/);
    expect(() => loadConfig({ NW_HEALTH_TIMEOUT_MS: 'soon' })).toThrow(/NW_HEALTH_TIMEOUT_MS/);
  });

  it('parses scrape targets, the Control Room and the bus', () => {
    const c = loadConfig({
      NW_METRICS_TARGETS: 'control-room=http://cr:9000/metrics, orchestrator=http://or:9200/metrics',
      NW_CONTROL_ROOM_URL: 'http://cr:9000/',
      NW_RABBITMQ_URL: 'amqp://guest:guest@rabbitmq:5672',
    });
    expect(c.metrics.targets.map((t) => t.name)).toEqual(['control-room', 'orchestrator']);
    expect(c.controlRoom?.url).toBe('http://cr:9000');
    expect(c.controlRoom?.nodePattern.test('node-pi')).toBe(true);
    expect(c.bus?.queue).toBe('nexuswatch.collector');
    expect(() => loadConfig({ NW_METRICS_TARGETS: 'http://x/metrics' })).toThrow(/name=/);
  });

  it('leaves every notification channel off until its variables are set', () => {
    const c = loadConfig({});
    expect(c.notify.targets).toEqual({ discord: null, telegram: null, push: null, email: null });
    expect(c.notify.publicUrl).toBeNull();
  });

  it('reads the notification targets', () => {
    const c = loadConfig({
      NW_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc',
      NW_TELEGRAM_BOT_TOKEN: '123456:ABC-def_1',
      NW_TELEGRAM_CHAT_ID: '-100200',
      NW_NTFY_URL: 'https://ntfy.example.org/home-alerts',
      NW_NTFY_TOKEN: 'tk_1',
      NW_SMTP_URL: 'smtp://user:pass@mail.example.org:587',
      NW_EMAIL_FROM: 'watch@example.org',
      NW_EMAIL_TO: 'tom@example.org',
      NW_PUBLIC_URL: 'https://watch.example.org/',
    });
    expect(c.notify.targets.discord?.url).toBe('https://discord.com/api/webhooks/1/abc');
    expect(c.notify.targets.telegram).toEqual({ token: '123456:ABC-def_1', chatId: '-100200' });
    expect(c.notify.targets.push).toEqual({ server: 'https://ntfy.example.org/', topic: 'home-alerts', token: 'tk_1' });
    expect(c.notify.targets.email?.to).toBe('tom@example.org');
    expect(c.notify.publicUrl).toBe('https://watch.example.org');
  });

  it('refuses notification targets that are half set or point somewhere unexpected', () => {
    expect(() => loadConfig({ NW_DISCORD_WEBHOOK_URL: 'https://example.org/api/webhooks/1/abc' })).toThrow(/discord\.com/);
    expect(() => loadConfig({ NW_DISCORD_WEBHOOK_URL: 'http://discord.com/api/webhooks/1/abc' })).toThrow(/discord\.com/);
    expect(() => loadConfig({ NW_DISCORD_WEBHOOK_URL: 'https://discord.com.evil.example/api/webhooks/1/abc' })).toThrow(/discord\.com/);
    expect(() => loadConfig({ NW_TELEGRAM_BOT_TOKEN: '123456:ABC' })).toThrow(/together/);
    expect(() => loadConfig({ NW_TELEGRAM_BOT_TOKEN: 'not a token', NW_TELEGRAM_CHAT_ID: '1' })).toThrow(/123456:ABC-DEF/);
    expect(() => loadConfig({ NW_NTFY_URL: 'https://ntfy.sh/' })).toThrow(/topic/);
    expect(() => loadConfig({ NW_NTFY_URL: 'file:///etc/passwd' })).toThrow(/http/);
    expect(() => loadConfig({ NW_SMTP_URL: 'smtp://mail.example.org' })).toThrow(/together/);
    expect(() => loadConfig({ NW_SMTP_URL: 'http://mail.example.org', NW_EMAIL_FROM: 'a@b.c', NW_EMAIL_TO: 'd@e.f' })).toThrow(/smtp/);
  });
});
