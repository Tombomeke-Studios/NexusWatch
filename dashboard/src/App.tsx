import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { AuthGate } from '@/components/layout/AuthGate';
import { OverviewPage } from '@/pages/Overview';

/**
 * Every page but Overview loads when it is first opened (its own chunk), so the first paint on a
 * phone does not wait for the whole app.
 */
const page = <M,>(load: () => Promise<M>, pick: (m: M) => React.ComponentType) => async () => ({ Component: pick(await load()) });

/** Route table. Paths mirror `routes.ts`. */
export const routeTable: RouteObject[] = [
  {
    element: (
      <AuthGate>
        <AppShell />
      </AuthGate>
    ),
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'heartbeats', lazy: page(() => import('@/pages/Heartbeats'), (m) => m.HeartbeatsPage) },
      { path: 'logs', lazy: page(() => import('@/pages/Logs'), (m) => m.LogsPage) },
      { path: 'metrics', lazy: page(() => import('@/pages/Metrics'), (m) => m.MetricsPage) },
      { path: 'alerts', lazy: page(() => import('@/pages/Alerts'), (m) => m.AlertsPage) },
      { path: 'services/:serviceId', lazy: page(() => import('@/pages/ServiceDetail'), (m) => m.ServiceDetailPage) },
      { path: 'projects/nexusinfra', lazy: page(() => import('@/pages/projects/NexusInfra'), (m) => m.NexusInfraPage) },
      { path: 'projects/finvault', lazy: page(() => import('@/pages/projects/FinVault'), (m) => m.FinVaultPage) },
      { path: 'settings', lazy: page(() => import('@/pages/Settings'), (m) => m.SettingsPage) },
      { path: 'slo', lazy: page(() => import('@/pages/Slo'), (m) => m.SloPage) },
      { path: 'incidents', lazy: page(() => import('@/pages/Incidents'), (m) => m.IncidentsPage) },
      { path: 'incidents/:incidentId', lazy: page(() => import('@/pages/IncidentDetail'), (m) => m.IncidentDetailPage) },
      { path: 'business', lazy: page(() => import('@/pages/Business'), (m) => m.BusinessPage) },
      { path: '*', lazy: page(() => import('@/pages/NotFound'), (m) => m.NotFoundPage) },
    ],
  },
  // Public and shareable: no sidebar, no internal navigation.
  { path: 'status', lazy: page(() => import('@/pages/StatusPage'), (m) => m.StatusPage) },
];

const router = createBrowserRouter(routeTable);

export function App() {
  return <RouterProvider router={router} />;
}
