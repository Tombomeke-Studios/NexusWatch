import type { ProjectId } from '@/api/types';

/** Every URL in the app. Build links from here, never from string literals in pages. */
export const routes = {
  overview: '/',
  heartbeats: '/heartbeats',
  logs: '/logs',
  /** Logs filtered on a search term, optionally with one line selected. */
  logsFor: (q: string, entryId?: string) => `/logs?${new URLSearchParams({ q, ...(entryId ? { entry: entryId } : {}) })}`,
  metrics: '/metrics',
  alerts: '/alerts',
  service: (id: string) => `/services/${encodeURIComponent(id)}`,
  project: (id: ProjectId) => `/projects/${id}`,
  settings: '/settings',
  slo: '/slo',
  /** SLOs with one service's burn-down selected. */
  sloFor: (serviceId: string) => `/slo?${new URLSearchParams({ service: serviceId })}`,
  incidents: '/incidents',
  incident: (id: string) => `/incidents/${encodeURIComponent(id)}`,
  /** Public, shareable status page — rendered without the app shell. */
  status: '/status',
  /** Money flow FinVault → NexusInfra: top-up reconciliation, credit, event bus. */
  business: '/business',
} as const;
