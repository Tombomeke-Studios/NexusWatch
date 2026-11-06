import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { OverviewPage } from '@/pages/Overview';
import { MetricsPage } from '@/pages/Metrics';
import { LogsPage } from '@/pages/Logs';
import { HeartbeatsPage } from '@/pages/Heartbeats';
import { AlertsPage } from '@/pages/Alerts';
import { ServiceDetailPage } from '@/pages/ServiceDetail';
import { NexusInfraPage } from '@/pages/projects/NexusInfra';
import { FinVaultPage } from '@/pages/projects/FinVault';
import { SettingsPage } from '@/pages/Settings';
import { NotFoundPage } from '@/pages/NotFound';
import { SloPage } from '@/pages/Slo';
import { IncidentsPage } from '@/pages/Incidents';
import { IncidentDetailPage } from '@/pages/IncidentDetail';
import { StatusPage } from '@/pages/StatusPage';

/** Route table. Paths mirror `routes.ts`. */
export const routeTable: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'heartbeats', element: <HeartbeatsPage /> },
      { path: 'logs', element: <LogsPage /> },
      { path: 'metrics', element: <MetricsPage /> },
      { path: 'alerts', element: <AlertsPage /> },
      { path: 'services/:serviceId', element: <ServiceDetailPage /> },
      { path: 'projects/nexusinfra', element: <NexusInfraPage /> },
      { path: 'projects/finvault', element: <FinVaultPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'slo', element: <SloPage /> },
      { path: 'incidents', element: <IncidentsPage /> },
      { path: 'incidents/:incidentId', element: <IncidentDetailPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // Public and shareable: no sidebar, no internal navigation.
  { path: 'status', element: <StatusPage /> },
];

const router = createBrowserRouter(routeTable);

export function App() {
  return <RouterProvider router={router} />;
}
