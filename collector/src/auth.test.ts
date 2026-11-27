import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Auth, isPublic, sessionFrom } from './auth.js';
import { loadConfig } from './config.js';
import { createApp } from './server.js';
import { Store } from './store.js';
import { createCtx } from './views/ctx.js';

describe('Auth', () => {
  it('is open without a password', () => {
    expect(new Auth(new Store(), null, () => 0).allows(null)).toBe(true);
  });

  it('issues a session for the right password, limits wrong ones, and logs out', () => {
    let now = 0;
    const auth = new Auth(new Store(), 'correct horse', () => now);
    expect(auth.allows(null)).toBe(false);
    for (let i = 0; i < 5; i++) expect(() => auth.login('wrong', 'a')).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => auth.login('correct horse', 'a')).toThrow(expect.objectContaining({ status: 429 }));
    // Another client is not affected, and the limit lifts after a minute.
    const token = auth.login('correct horse', 'b');
    expect(auth.allows(token)).toBe(true);
    now += 61_000;
    expect(auth.login('correct horse', 'a')).toBeTruthy();
    auth.logout(token);
    expect(auth.allows(token)).toBe(false);
  });

  it('expires a session after 30 days', () => {
    let now = 0;
    const auth = new Auth(new Store(), 'correct horse', () => now);
    const token = auth.login('correct horse', 'a');
    now += 31 * 24 * 3_600_000;
    expect(auth.allows(token)).toBe(false);
  });

  it('reads the session cookie and knows the public paths', () => {
    expect(sessionFrom('a=1; nw_session=abc%3D; b=2')).toBe('abc=');
    expect(sessionFrom(undefined)).toBeNull();
    expect(isPublic('GET', '/status')).toBe(true);
    expect(isPublic('POST', '/auth/login')).toBe(true);
    expect(isPublic('GET', '/overview')).toBe(false);
  });
});

describe('the API behind a password', () => {
  let base = '';
  let close: () => void = () => undefined;
  beforeAll(async () => {
    const ctx = createCtx(new Store(), loadConfig({ NW_DASHBOARD_PASSWORD: 'correct horse' }));
    const server = createApp(ctx).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it('answers 401 without a session, keeps /status and /health public, and works after logging in', async () => {
    expect((await fetch(`${base}/api/overview`)).status).toBe(401);
    expect((await fetch(`${base}/api/status`)).status).toBe(200);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect(await (await fetch(`${base}/api/auth`)).json()).toEqual({ required: true, authenticated: false });

    const json = { 'Content-Type': 'application/json' };
    expect((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ password: 'nope' }) })).status).toBe(401);
    const ok = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ password: 'correct horse' }) });
    expect(ok.status).toBe(204);
    const cookie = ok.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/nw_session=.+; .*HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const session = cookie.split(';')[0];
    expect((await fetch(`${base}/api/overview`, { headers: { Cookie: session } })).status).toBe(200);
    expect(await (await fetch(`${base}/api/auth`, { headers: { Cookie: session } })).json()).toEqual({ required: true, authenticated: true });

    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: session } });
    expect((await fetch(`${base}/api/overview`, { headers: { Cookie: session } })).status).toBe(401);
  });

  it('refuses a short password at start', () => {
    expect(() => loadConfig({ NW_DASHBOARD_PASSWORD: 'short' })).toThrow(/at least 8/);
  });
});
