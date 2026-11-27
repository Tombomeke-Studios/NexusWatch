import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routeTable } from '@/App';
import { ThemeProvider } from '@/theme';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routeTable, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe('Heartbeats → Add monitor', () => {
  it('checks the URL, adds the monitor and opens it, where it can be paused and removed', async () => {
    const router = renderAt('/heartbeats');
    fireEvent.click(await screen.findByRole('button', { name: '+ Add monitor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add monitor' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Billing panel' } });
    fireEvent.change(within(dialog).getByLabelText('URL to check'), { target: { value: 'http://localhost:8096' } });
    expect(within(dialog).getByText(/local or metadata address/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('URL to check'), { target: { value: 'http://host.docker.internal:8096' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add monitor' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing panel' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/services/m-billing-panel');

    fireEvent.click(screen.getByRole('button', { name: 'Pause monitor' }));
    expect(await screen.findByText(/This monitor is not checked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove monitor' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Heartbeats' })).toBeInTheDocument();
  });
});
