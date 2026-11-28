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

  it('sets up Telegram write-only: checks the fields, saves, and never shows the token again', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('tab', { name: 'Notifications' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up Telegram' });
    const token = within(dialog).getByLabelText('Bot token');
    expect(token).toHaveAttribute('type', 'password');
    fireEvent.change(token, { target: { value: 'nope' } });
    expect(within(dialog).getByText(/Must look like 123456:ABC-DEF/)).toBeInTheDocument();

    fireEvent.change(token, { target: { value: '123456:ABCdefGHIjklMNOpqrSTUvwxYZ_12345' } });
    fireEvent.change(within(dialog).getByLabelText('Chat id'), { target: { value: '-100123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByDisplayValue('chat -100123 via bot ••••2345')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/ABCdefGHI/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
