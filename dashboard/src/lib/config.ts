/** Build-time configuration from Vite env vars. See dashboard/.env.example. */
export const config = {
  /** Serve the built-in sample data instead of calling the API. Default on until the backend exists. */
  useMocks: (import.meta.env.VITE_USE_MOCKS ?? 'true') !== 'false',
  apiBase: (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, ''),
  refreshMs: Number(import.meta.env.VITE_REFRESH_MS ?? 10_000) || 10_000,
} as const;
