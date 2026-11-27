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
  MetricsOverview, NavCounts, NexusInfraData, OverviewData, ServiceCheckResult, ServiceDetail, SettingsData, TimeRange,
} from './types';
import type {
  IncidentDetail, IncidentsData, NewIncident, NewIncidentUpdate, ResolveIncident, SloData, StatusPageData,
} from './types';
import type { AuthState, BusinessData, ChannelConfig, ChannelId, ChannelTestResult } from './types';
import type {
  AlertRule, AlertRuleInput, EscalationPolicy, EscalationPolicyInput, MaintenanceInput, MaintenanceWindow, RuleTestResult, Silence,
  SilenceInput,
} from './types';

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
  acknowledgeAlert: (id: string, note = ''): Promise<void> =>
    config.useMocks ? fromMock(() => mock.acknowledgeAlert(id, note)) : request(`/alerts/${id}/ack`, { method: 'POST', body: json({ note }) }),
  resolveAlert: (id: string, note = ''): Promise<void> =>
    config.useMocks ? fromMock(() => mock.resolveAlert(id, note)) : request(`/alerts/${id}/resolve`, { method: 'POST', body: json({ note }) }),
  setRuleEnabled: (id: string, enabled: boolean): Promise<void> =>
    config.useMocks
      ? fromMock(() => mock.setRuleEnabled(id, enabled))
      : request(`/alert-rules/${id}`, { method: 'PATCH', body: json({ enabled }) }),
  createRule: (rule: AlertRuleInput): Promise<AlertRule> =>
    config.useMocks ? fromMock(() => mock.createRule(rule)) : request('/alert-rules', { method: 'POST', body: json(rule) }),
  updateRule: (id: string, rule: AlertRuleInput): Promise<AlertRule> =>
    config.useMocks ? fromMock(() => mock.updateRule(id, rule)) : request(`/alert-rules/${id}`, { method: 'PUT', body: json(rule) }),
  deleteRule: (id: string): Promise<void> =>
    config.useMocks ? fromMock(() => mock.deleteRule(id)) : request(`/alert-rules/${id}`, { method: 'DELETE' }),
  testRule: (rule: Pick<AlertRuleInput, 'project' | 'condition'>): Promise<RuleTestResult> =>
    config.useMocks ? fromMock(() => mock.testRule(rule)) : request('/alert-rules/test', { method: 'POST', body: json(rule) }),

  createSilence: (input: SilenceInput): Promise<Silence> =>
    config.useMocks ? fromMock(() => mock.createSilence(input)) : request('/silences', { method: 'POST', body: json(input) }),
  deleteSilence: (id: string): Promise<void> =>
    config.useMocks ? fromMock(() => mock.deleteSilence(id)) : request(`/silences/${id}`, { method: 'DELETE' }),

  createMaintenance: (input: MaintenanceInput): Promise<MaintenanceWindow> =>
    config.useMocks ? fromMock(() => mock.createMaintenance(input)) : request('/maintenance-windows', { method: 'POST', body: json(input) }),
  updateMaintenance: (id: string, input: MaintenanceInput): Promise<MaintenanceWindow> =>
    config.useMocks ? fromMock(() => mock.updateMaintenance(id, input)) : request(`/maintenance-windows/${id}`, { method: 'PUT', body: json(input) }),
  deleteMaintenance: (id: string): Promise<void> =>
    config.useMocks ? fromMock(() => mock.deleteMaintenance(id)) : request(`/maintenance-windows/${id}`, { method: 'DELETE' }),

  createPolicy: (input: EscalationPolicyInput): Promise<EscalationPolicy> =>
    config.useMocks ? fromMock(() => mock.createPolicy(input)) : request('/escalation-policies', { method: 'POST', body: json(input) }),
  updatePolicy: (id: string, input: EscalationPolicyInput): Promise<EscalationPolicy> =>
    config.useMocks ? fromMock(() => mock.updatePolicy(id, input)) : request(`/escalation-policies/${id}`, { method: 'PUT', body: json(input) }),
  deletePolicy: (id: string): Promise<void> =>
    config.useMocks ? fromMock(() => mock.deletePolicy(id)) : request(`/escalation-policies/${id}`, { method: 'DELETE' }),

  service: (id: string): Promise<ServiceDetail> =>
    config.useMocks
      ? fromMock(() => {
          const detail = mock.serviceDetail(id);
          if (!detail) throw new ApiError(404, `Service ${id} not found`);
          return detail;
        })
      : request(`/services/${encodeURIComponent(id)}`),

  /** Login state. Sample data never asks for one; a backend without `/auth` (older collector) neither. */
  auth: (): Promise<AuthState> =>
    config.useMocks
      ? Promise.resolve({ required: false, authenticated: true })
      : request<AuthState>('/auth').catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return { required: false, authenticated: true };
          throw err;
        }),
  login: (password: string): Promise<void> => request('/auth/login', { method: 'POST', body: json({ password }) }),
  logout: (): Promise<void> => request('/auth/logout', { method: 'POST' }),

  /** "Test now": runs one health check right away (404 for a service that is not monitored). */
  checkService: (id: string): Promise<ServiceCheckResult> =>
    config.useMocks ? fromMock(() => mock.checkService(id)) : request(`/services/${encodeURIComponent(id)}/check`, { method: 'POST' }),

  nexusInfra: (): Promise<NexusInfraData> => (config.useMocks ? fromMock(mock.nexusInfra) : request('/projects/nexusinfra')),
  finVault: (): Promise<FinVaultData> => (config.useMocks ? fromMock(mock.finVault) : request('/projects/finvault')),

  business: (): Promise<BusinessData> => (config.useMocks ? fromMock(mock.business) : request('/business')),

  settings: (): Promise<SettingsData> => (config.useMocks ? fromMock(mock.settings) : request('/settings')),
  updateSettings: (patch: Partial<Pick<SettingsData, 'channels' | 'routing' | 'retention'>>): Promise<void> =>
    config.useMocks ? fromMock(() => mock.updateSettings(patch)) : request('/settings', { method: 'PATCH', body: json(patch) }),
  /** Sets up a channel; the body is write-only (422 when a field does not validate, 409 when .env sets it). */
  configureChannel: (id: ChannelId, body: ChannelConfig): Promise<void> =>
    config.useMocks ? fromMock(() => mock.configureChannel(id, body)) : request(`/settings/channels/${id}`, { method: 'PUT', body: json(body) }),
  removeChannel: (id: ChannelId): Promise<void> =>
    config.useMocks ? fromMock(() => mock.removeChannelConfig(id)) : request(`/settings/channels/${id}`, { method: 'DELETE' }),
  /** Sends one test message through a channel. A failed delivery comes back as `{ ok: false }`, not as an error. */
  testChannel: (id: ChannelId): Promise<ChannelTestResult> =>
    config.useMocks ? fromMock(() => mock.testChannel(id)) : request(`/settings/channels/${id}/test`, { method: 'POST' }),

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
