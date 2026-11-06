import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routeTable } from '@/App';
import { ThemeProvider } from '@/theme';

function renderAlerts() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routeTable, { initialEntries: ['/alerts'] });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const tab = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));

async function openNewRule() {
  renderAlerts();
  const button = await screen.findByRole('button', { name: '+ New rule' });
  await waitFor(() => expect(button).toBeEnabled());
  button.focus();
  fireEvent.click(button);
  return { button, dialog: screen.getByRole('dialog', { name: 'New rule' }) };
}

describe('rule editor', () => {
  it('opens with the name focused and closes on Escape, giving focus back', async () => {
    const { button, dialog } = await openNewRule();
    const name = within(dialog).getByLabelText('Name');
    expect(name).toHaveFocus();
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('validates live and previews the condition', async () => {
    const { dialog } = await openNewRule();
    const d = within(dialog);
    expect(d.getByTestId('condition-preview')).toHaveTextContent('heartbeat == 0 for 1m30s');

    fireEvent.change(d.getByLabelText('Threshold'), { target: { value: '5' } });
    expect(d.getByText('Heartbeat cannot be above 1')).toBeInTheDocument();
    expect(d.getByLabelText('Threshold')).toHaveAttribute('aria-invalid', 'true');
    expect(d.getByTestId('condition-preview')).toHaveTextContent('—');

    fireEvent.change(d.getByLabelText('Metric'), { target: { value: 'cpu' } });
    fireEvent.change(d.getByLabelText('Comparator'), { target: { value: '>' } });
    fireEvent.change(d.getByLabelText('Threshold'), { target: { value: '85' } });
    fireEvent.change(d.getByLabelText('For'), { target: { value: '10m' } });
    expect(d.queryByText(/cannot be above/)).not.toBeInTheDocument();
    expect(d.getByTestId('condition-preview')).toHaveTextContent('cpu > 85% for 10m');

    fireEvent.change(d.getByLabelText('For'), { target: { value: 'soon' } });
    expect(d.getByText('Use a duration such as 90s, 5m or 1h30m')).toBeInTheDocument();
  });

  it('refuses to save without a name and focuses the field', async () => {
    const { dialog } = await openNewRule();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    expect(within(dialog).getByText('Give the rule a name')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();
  });

  it('tests a draft against the current data', async () => {
    const { dialog } = await openNewRule();
    fireEvent.change(within(dialog).getByLabelText('Project'), { target: { value: 'finvault' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test against current data' }));
    expect(await within(dialog).findByText('Would fire now')).toBeInTheDocument();
    const result = within(dialog).getByRole('status', { name: 'Test result' });
    expect(within(result).getByText('invoice-service')).toBeInTheDocument();
  });

  it('saves a new rule into the rules list', async () => {
    const { dialog } = await openNewRule();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Agent silent' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    tab(/^Rules/);
    expect(await screen.findByText('Agent silent')).toBeInTheDocument();
  });

  it('duplicates a rule and asks before deleting, with Cancel focused', async () => {
    renderAlerts();
    await screen.findByRole('tab', { name: /^Rules/ });
    tab(/^Rules/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit High CPU (NexusInfra)' }));
    let dialog = screen.getByRole('dialog', { name: 'Edit rule' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('High CPU');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    dialog = screen.getByRole('dialog', { name: 'Duplicate rule' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('High CPU (copy)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit High CPU (NexusInfra)' }));
    dialog = screen.getByRole('dialog', { name: 'Edit rule' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete "High CPU"?' });
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete rule' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('High CPU')).not.toBeInTheDocument());
  });
});

describe('silences and history', () => {
  it('mutes an active alert with a reason and unmutes it from the silences list', async () => {
    renderAlerts();
    const card = await screen.findByRole('article', { name: 'invoice-service is not responding' });
    fireEvent.click(within(card).getByRole('button', { name: 'Mute…' }));
    const dialog = screen.getByRole('dialog', { name: 'Mute alert' });
    fireEvent.click(within(dialog).getByRole('button', { name: '15 min' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mute' }));
    expect(within(dialog).getByText('Say why, so whoever looks next knows')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Fix is deploying' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await within(card).findByText(/muted · 1[45]:\d\d left/)).toBeInTheDocument();

    tab(/^Silences/);
    const unmute = await screen.findByRole('button', { name: 'Unmute invoice-service is not responding' });
    fireEvent.click(unmute);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Unmute invoice-service is not responding' })).not.toBeInTheDocument());
  });

  it('labels an alert inside a maintenance window', async () => {
    renderAlerts();
    const card = await screen.findByRole('article', { name: 'node-02 is slow' });
    expect(within(card).getByText('in maintenance · notifications suppressed')).toBeInTheDocument();
    expect(within(card).getAllByText('suppressed').length).toBeGreaterThan(0);
  });

  it('filters the history and shows an entry’s notes', async () => {
    renderAlerts();
    await screen.findByRole('tab', { name: 'History' });
    tab(/^History/);
    const filters = screen.getByRole('group', { name: 'History filters' });
    fireEvent.click(within(within(filters).getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Open' }));
    expect(screen.queryByText('Queue wallet.events backing up')).not.toBeInTheDocument();
    fireEvent.click(within(within(filters).getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Resolved' }));
    fireEvent.click(within(within(filters).getByRole('group', { name: 'Project' })).getByRole('button', { name: 'FinVault' }));
    const row = screen.getByRole('button', { name: /Queue wallet.events backing up/ });
    expect(screen.queryByText('High CPU on node-02')).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Consumer back, queue drained')).toBeInTheDocument();
  });
});
