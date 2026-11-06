/**
 * Every backend call the dashboard makes. Each one either serves sample data (VITE_USE_MOCKS)
 * or calls the real API — pages never know which. The paths here are the API contract;
 * keep docs/api.md in step when one changes.
 */
import { config } from '@/lib/config';
import { ApiError, request } from './client';
import * as mock from './mock/data';
import * as reliability from './mock/reliability';
import type {
  AlertsData, FinVaultData, HeartbeatsData, HostInfo, LogQuery, LogsData, MetricData, MetricId,
  MetricsOverview, NavCounts, NexusInfraData, OverviewData, ServiceDetail, SettingsData, TimeRange,
} from './types';
import type {
  IncidentDetail, IncidentsData, NewIncident, NewIncidentUpdate, ResolveIncident, SloData, StatusPageData,
} from './types';
import type { BusinessData } from './types';

/** Simulated latency so loading states are visible while working on mocks. */
const MOCK_DELAY_MS = 180;

function fromMock<T>(produce: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(produce());
      } catch (err) {
        reject(err);
      }
    }, MOCK_DELAY_MS);
  });
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  host: (): Promise<HostInfo> => (config.useMocks ? fromMock(mock.host) : request('/host')),
  navCounts: (): Promise<NavCounts> => (config.useMocks ? fromMock(mock.navCounts) : request('/nav')),

  overview: (range: TimeRange): Promise<OverviewData> =>
    config.useMocks ? fromMock(mock.overview) : request('/overview', { params: { range } }),

  metric: (id: MetricId, range: TimeRange): Promise<MetricData> =>
    config.useMocks ? fromMock(() => mock.metric(id)) : request(`/metrics/${id}`, { params: { range } }),
  metricsOverview: (range: TimeRange): Promise<MetricsOverview> =>
    config.useMocks ? fromMock(mock.metricsOverview) : request('/metrics', { params: { range } }),

  logs: (q: LogQuery): Promise<LogsData> =>
    config.useMocks
      ? fromMock(() => mock.logs(q))
      : request('/logs', { params: { q: q.query, range: q.range, level: q.levels, project: q.project } }),

  heartbeats: (): Promise<HeartbeatsData> => (config.useMocks ? fromMock(mock.heartbeats) : request('/heartbeats')),

  alerts: (): Promise<AlertsData> => (config.useMocks ? fromMock(mock.alerts) : request('/alerts')),
  acknowledgeAlert: (id: string): Promise<void> =>
    config.useMocks ? fromMock(() => mock.acknowledgeAlert(id)) : request(`/alerts/${id}/ack`, { method: 'POST' }),
  setRuleEnabled: (id: string, enabled: boolean): Promise<void> =>
    config.useMocks
      ? fromMock(() => mock.setRuleEnabled(id, enabled))
      : request(`/alert-rules/${id}`, { method: 'PATCH', body: json({ enabled }) }),

  service: (id: string): Promise<ServiceDetail> =>
    config.useMocks
      ? fromMock(() => {
          const detail = mock.serviceDetail(id);
          if (!detail) throw new ApiError(404, `Service ${id} not found`);
          return detail;
        })
      : request(`/services/${encodeURIComponent(id)}`),

  nexusInfra: (): Promise<NexusInfraData> => (config.useMocks ? fromMock(mock.nexusInfra) : request('/projects/nexusinfra')),
  finVault: (): Promise<FinVaultData> => (config.useMocks ? fromMock(mock.finVault) : request('/projects/finvault')),

  business: (): Promise<BusinessData> => (config.useMocks ? fromMock(mock.business) : request('/business')),

  settings: (): Promise<SettingsData> => (config.useMocks ? fromMock(mock.settings) : request('/settings')),
  updateSettings: (patch: Partial<Pick<SettingsData, 'channels' | 'routing' | 'retention'>>): Promise<void> =>
    config.useMocks ? fromMock(() => mock.updateSettings(patch)) : request('/settings', { method: 'PATCH', body: json(patch) }),

  // Reliability: SLOs, incidents and the public status page.
  slos: (): Promise<SloData> => (config.useMocks ? fromMock(reliability.slos) : request('/slos')),
  incidents: (): Promise<IncidentsData> => (config.useMocks ? fromMock(reliability.incidents) : request('/incidents')),
  incident: (id: string): Promise<IncidentDetail> =>
    config.useMocks
      ? fromMock(() => {
          const detail = reliability.incident(id);
          if (!detail) throw new ApiError(404, `Incident ${id} not found`);
          return detail;
        })
      : request(`/incidents/${encodeURIComponent(id)}`),
  createIncident: (input: NewIncident): Promise<IncidentDetail> =>
    config.useMocks ? fromMock(() => reliability.createIncident(input)) : request('/incidents', { method: 'POST', body: json(input) }),
  postIncidentUpdate: (id: string, input: NewIncidentUpdate): Promise<IncidentDetail> =>
    config.useMocks
      ? fromMock(() => reliability.postIncidentUpdate(id, input))
      : request(`/incidents/${encodeURIComponent(id)}/updates`, { method: 'POST', body: json(input) }),
  resolveIncident: (id: string, input: ResolveIncident): Promise<IncidentDetail> =>
    config.useMocks
      ? fromMock(() => reliability.resolveIncident(id, input))
      : request(`/incidents/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: json(input) }),
  /** Public and unauthenticated: the only call the shareable /status page makes. */
  statusPage: (): Promise<StatusPageData> => (config.useMocks ? fromMock(reliability.statusPage) : request('/status')),
};
