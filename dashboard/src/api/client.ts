import { config } from '@/lib/config';

/** A non-2xx answer from the API. `status` 0 means the request never got an answer. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type QueryParams = Record<string, string | number | boolean | string[] | undefined>;

/** Builds `<apiBase><path>?…`; arrays become comma-separated, undefined values are dropped. */
export function buildUrl(path: string, params?: QueryParams, base = config.apiBase): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue;
    qs.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const query = qs.toString();
  return `${base}${path}${query ? `?${query}` : ''}`;
}

/** The one way the dashboard talks to the backend. JSON in, JSON out, `ApiError` on failure. */
export async function request<T>(path: string, init: RequestInit & { params?: QueryParams } = {}): Promise<T> {
  const { params, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, params), {
      ...rest,
      headers: { Accept: 'application/json', ...(rest.body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    });
  } catch (err) {
    throw new ApiError(0, err instanceof Error ? err.message : 'Network error');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
