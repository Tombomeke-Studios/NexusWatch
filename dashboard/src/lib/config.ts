/**
 * Build-time configuration from Vite env vars. See dashboard/.env.example.
 *
 * `import.meta.env` only exists under Vite. The collector imports the dashboard's mocks from source
 * (mock → client → config) and runs in plain Node, where it is undefined — so read it defensively.
 */
const env: Partial<Record<'VITE_USE_MOCKS' | 'VITE_API_BASE' | 'VITE_REFRESH_MS', string>> =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

export const config = {
  /** Serve the built-in sample data instead of calling the API. Default on until the backend exists. */
  useMocks: (env.VITE_USE_MOCKS ?? 'true') !== 'false',
  apiBase: (env.VITE_API_BASE ?? '/api').replace(/\/$/, ''),
  refreshMs: Number(env.VITE_REFRESH_MS ?? 10_000) || 10_000,
} as const;
