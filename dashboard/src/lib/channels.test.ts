import { describe, expect, it } from 'vitest';
import { CHANNEL_FIELDS, isBlockedHost, validateChannelConfig } from './channels';

describe('validateChannelConfig', () => {
  it('accepts a Discord webhook on discord.com only', () => {
    expect(validateChannelConfig('discord', { webhookUrl: ' https://discord.com/api/webhooks/123/abc_DEF ' })).toEqual({
      ok: true,
      target: { url: 'https://discord.com/api/webhooks/123/abc_DEF' },
    });
    for (const webhookUrl of ['http://discord.com/api/webhooks/1/a', 'https://evil.example/api/webhooks/1/a', 'https://discord.com/other', 'nope']) {
      expect(validateChannelConfig('discord', { webhookUrl }).ok, webhookUrl).toBe(false);
    }
  });

  it('checks a Telegram bot token and chat id', () => {
    expect(validateChannelConfig('telegram', { botToken: '123456:ABCdefGHIjklMNOpqrSTUvwxYZ_12345', chatId: '-1001234567890' })).toMatchObject({ ok: true, target: { chatId: '-1001234567890' } });
    expect(validateChannelConfig('telegram', { botToken: '123456:ABCdefGHIjklMNOpqrSTUvwxYZ_12345', chatId: '@my_channel' }).ok).toBe(true);
    expect(validateChannelConfig('telegram', { botToken: 'nope', chatId: '1' })).toMatchObject({ ok: false, field: 'botToken' });
    expect(validateChannelConfig('telegram', { botToken: '123456:ABCdefGHIjklMNOpqrSTUvwxYZ_12345', chatId: 'x y' })).toMatchObject({ ok: false, field: 'chatId' });
  });

  it('splits an ntfy URL into server and topic, and refuses local addresses', () => {
    expect(validateChannelConfig('push', { url: 'https://ntfy.sh/my-topic', token: '' })).toEqual({ ok: true, target: { server: 'https://ntfy.sh/', topic: 'my-topic', token: undefined } });
    expect(validateChannelConfig('push', { url: 'https://ntfy.sh/a/b' })).toMatchObject({ ok: false, field: 'url' });
    expect(validateChannelConfig('push', { url: 'http://127.0.0.1:8080/topic' })).toMatchObject({ ok: false, field: 'url' });
    expect(validateChannelConfig('push', { url: 'http://192.168.0.117:8090/alerts' }).ok).toBe(true);
  });

  it('needs an SMTP URL and two addresses for email', () => {
    expect(validateChannelConfig('email', { smtpUrl: 'smtps://u:p@mail.example.org:465', from: 'nw@example.org', to: 'me@example.org' }).ok).toBe(true);
    expect(validateChannelConfig('email', { smtpUrl: 'http://mail', from: 'a@b.c', to: 'a@b.c' })).toMatchObject({ ok: false, field: 'smtpUrl' });
    expect(validateChannelConfig('email', { smtpUrl: 'smtp://169.254.169.254', from: 'a@b.c', to: 'a@b.c' })).toMatchObject({ ok: false, field: 'smtpUrl' });
    expect(validateChannelConfig('email', { smtpUrl: 'smtp://mail.example.org', from: 'nope', to: 'a@b.c' })).toMatchObject({ ok: false, field: 'from' });
  });

  it('describes a form for every channel', () => {
    expect(Object.keys(CHANNEL_FIELDS).sort()).toEqual(['discord', 'email', 'push', 'telegram']);
  });
});

describe('isBlockedHost', () => {
  it('blocks loopback, link-local and cloud metadata, not the LAN', () => {
    for (const h of ['localhost', 'a.localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '[::1]', '::1', 'metadata.google.internal']) expect(isBlockedHost(h), h).toBe(true);
    for (const h of ['ntfy.sh', '192.168.0.117', '10.0.0.5', 'mail.example.org']) expect(isBlockedHost(h), h).toBe(false);
  });
});
