import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routeTable } from './App';
import { ThemeProvider, resolveTheme } from './theme';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routeTable, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('routing', () => {
  it.each([
    ['/', 'Overview'],
    ['/heartbeats', 'Heartbeats'],
    ['/logs', 'Logs'],
    ['/metrics', 'Metrics'],
    ['/alerts', 'Alerts'],
    ['/projects/nexusinfra', 'NexusInfra'],
    ['/projects/finvault', 'FinVault'],
    ['/settings', 'Settings'],
    ['/nope', 'Page not found'],
  ])('%s renders the "%s" page heading', async (path, heading) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('renders a service detail once its data arrives', async () => {
    renderAt('/services/fv-invoice-service');
    expect(await screen.findByRole('heading', { level: 1, name: 'invoice-service' })).toBeInTheDocument();
  });

  it('unfolds a service log line into its document and back', async () => {
    renderAt('/services/fv-invoice-service');
    const line = await screen.findByRole('button', { name: /unhandled rejection/ });
    expect(line).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(line);
    expect(line).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('"P1001"')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show in log stream →' })).toHaveAttribute('href', expect.stringContaining('/logs?q=invoice-service&entry=log_'));
    fireEvent.click(line);
    expect(screen.queryByText('"P1001"')).not.toBeInTheDocument();
  });

  it('only logs failed health checks for a service that is down', async () => {
    renderAt('/services/nx-billing-bridge');
    await screen.findByRole('heading', { level: 1, name: 'billing-bridge' });
    expect(screen.queryByText(/healthcheck failed/)).not.toBeInTheDocument();
  });

  it('opens a deep-linked log search with that line selected', async () => {
    renderAt('/logs?q=prisma');
    expect(await screen.findByDisplayValue('prisma')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Prisma P1001/, pressed: true })).toBeInTheDocument();
  });

  it('shows "Nothing here" for an unknown service', async () => {
    renderAt('/services/does-not-exist');
    expect(await screen.findByText('Nothing here')).toBeInTheDocument();
  });

  it('marks the current page in the sidebar', async () => {
    renderAt('/logs');
    const link = await screen.findByRole('link', { name: 'Logs' });
    expect(link).toHaveAttribute('aria-current', 'page');
  });
});

describe('resolveTheme', () => {
  it('follows the OS only for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
