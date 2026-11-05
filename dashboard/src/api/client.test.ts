import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, buildUrl, request } from './client';

describe('buildUrl', () => {
  it('joins arrays and drops undefined params', () => {
    expect(buildUrl('/logs', { q: 'a b', level: ['error', 'warn'], project: undefined }, '/api')).toBe('/api/logs?q=a+b&level=error%2Cwarn');
  });

  it('omits the question mark without params', () => {
    expect(buildUrl('/host', undefined, '/api')).toBe('/api/host');
  });
});

describe('request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(request('/x')).resolves.toEqual({ ok: true });
  });

  it('throws ApiError with the status on a non-2xx answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    await expect(request('/x')).rejects.toMatchObject({ name: 'ApiError', status: 404, message: 'nope' });
  });

  it('throws ApiError status 0 when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = (await request('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });
});
