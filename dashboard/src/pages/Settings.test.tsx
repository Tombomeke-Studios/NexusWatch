import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routeTable } from '@/App';
import { ThemeProvider } from '@/theme';

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routeTable, { initialEntries: ['/settings'] });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('Settings → Notifications', () => {
  it('sends a test through a channel and shows the outcome next to it', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('tab', { name: 'Notifications' }));
    const buttons = await screen.findAllByRole('button', { name: 'Send test' });
    expect(buttons).toHaveLength(4);
    expect(screen.queryByText(/Test sent/)).toBeNull();

    fireEvent.click(buttons[0]);
    const outcome = await screen.findByText(/Test sent — Sample data/);
    expect(outcome).toHaveAttribute('role', 'status');
    // Only the channel that was tested reports an outcome.
    expect(screen.getAllByText(/Test sent/)).toHaveLength(1);
    expect(within(outcome.parentElement as HTMLElement).getByText('Discord')).toBeInTheDocument();
  });
});
