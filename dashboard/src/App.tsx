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
import { BusinessPage } from '@/pages/Business';
import { NotFoundPage } from '@/pages/NotFound';

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
      { path: 'business', element: <BusinessPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

const router = createBrowserRouter(routeTable);

export function App() {
  return <RouterProvider router={router} />;
}
