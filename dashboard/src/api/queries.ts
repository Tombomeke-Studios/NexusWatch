/**
 * React Query hooks — the only way pages read data. Live views poll every VITE_REFRESH_MS;
 * mutations invalidate the queries they change.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '@/lib/config';
import { api } from './endpoints';
import type { LogQuery, MetricId, SettingsData, TimeRange } from './types';
import type { NewIncident, NewIncidentUpdate, ResolveIncident } from './types';

const live = { refetchInterval: config.refreshMs, placeholderData: keepPreviousData } as const;

export const keys = {
  host: ['host'] as const,
  nav: ['nav'] as const,
  overview: (range: TimeRange) => ['overview', range] as const,
  metric: (id: MetricId, range: TimeRange) => ['metric', id, range] as const,
  metricsOverview: (range: TimeRange) => ['metrics', range] as const,
  logs: (q: LogQuery) => ['logs', q] as const,
  heartbeats: ['heartbeats'] as const,
  alerts: ['alerts'] as const,
  service: (id: string) => ['service', id] as const,
  nexusInfra: ['project', 'nexusinfra'] as const,
  finVault: ['project', 'finvault'] as const,
  settings: ['settings'] as const,
  slos: ['slos'] as const,
  incidents: ['incidents'] as const,
  incident: (id: string) => ['incidents', id] as const,
  statusPage: ['status-page'] as const,
  business: ['business'] as const,
};

export const useHost = () => useQuery({ queryKey: keys.host, queryFn: api.host, ...live });
export const useNavCounts = () => useQuery({ queryKey: keys.nav, queryFn: api.navCounts, ...live });
export const useOverview = (range: TimeRange) => useQuery({ queryKey: keys.overview(range), queryFn: () => api.overview(range), ...live });
export const useMetric = (id: MetricId, range: TimeRange) => useQuery({ queryKey: keys.metric(id, range), queryFn: () => api.metric(id, range), ...live });
export const useMetricsOverview = (range: TimeRange) => useQuery({ queryKey: keys.metricsOverview(range), queryFn: () => api.metricsOverview(range), ...live });
export const useLogs = (q: LogQuery, tail: boolean) =>
  useQuery({ queryKey: keys.logs(q), queryFn: () => api.logs(q), placeholderData: keepPreviousData, refetchInterval: tail ? 2_000 : false });
export const useHeartbeats = () => useQuery({ queryKey: keys.heartbeats, queryFn: api.heartbeats, ...live });
export const useAlerts = () => useQuery({ queryKey: keys.alerts, queryFn: api.alerts, ...live });
export const useService = (id: string) => useQuery({ queryKey: keys.service(id), queryFn: () => api.service(id), ...live });
export const useNexusInfra = () => useQuery({ queryKey: keys.nexusInfra, queryFn: api.nexusInfra, ...live });
export const useFinVault = () => useQuery({ queryKey: keys.finVault, queryFn: api.finVault, ...live });
export const useBusiness = () => useQuery({ queryKey: keys.business, queryFn: api.business, ...live });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings });

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.acknowledgeAlert,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.alerts }),
  });
}

export function useSetRuleEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.setRuleEnabled(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.alerts }),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Pick<SettingsData, 'channels' | 'routing' | 'retention'>>) => api.updateSettings(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.settings }),
  });
}

// ── Reliability ─────────────────────────────────────────────────────────
export const useSlos = () => useQuery({ queryKey: keys.slos, queryFn: api.slos, ...live });
export const useIncidents = () => useQuery({ queryKey: keys.incidents, queryFn: api.incidents, ...live });
export const useIncident = (id: string) => useQuery({ queryKey: keys.incident(id), queryFn: () => api.incident(id), ...live });
/** The public page refreshes once a minute: it is shared, so it must stay cheap. */
export const useStatusPage = () => useQuery({ queryKey: keys.statusPage, queryFn: api.statusPage, refetchInterval: 60_000, placeholderData: keepPreviousData });

/** Incident changes show up in the incident pages, Heartbeats and the public status page. */
function useInvalidateIncidents() {
  const qc = useQueryClient();
  return () => Promise.all([keys.incidents, keys.heartbeats, keys.statusPage].map((queryKey) => qc.invalidateQueries({ queryKey })));
}

export function useCreateIncident() {
  const invalidate = useInvalidateIncidents();
  return useMutation({ mutationFn: (input: NewIncident) => api.createIncident(input), onSuccess: invalidate });
}

export function usePostIncidentUpdate(id: string) {
  const invalidate = useInvalidateIncidents();
  return useMutation({ mutationFn: (input: NewIncidentUpdate) => api.postIncidentUpdate(id, input), onSuccess: invalidate });
}

export function useResolveIncident(id: string) {
  const invalidate = useInvalidateIncidents();
  return useMutation({ mutationFn: (input: ResolveIncident) => api.resolveIncident(id, input), onSuccess: invalidate });
}
