import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routeTable } from '@/App';
import { ThemeProvider } from '@/theme';
import { trapIndex } from '../ui/Sheet';

/** Pretend to be a phone: every `max-width` query matches. */
function stubNarrow(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

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

describe('mobile shell', () => {
  beforeEach(() => stubNarrow(true));
  afterEach(() => vi.unstubAllGlobals());

  it('replaces the sidebar with a top bar and a bottom tab bar', async () => {
    renderAt('/heartbeats');
    const tabs = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(tabs).getAllByRole('link').map((l) => l.textContent)).toEqual(['Overview', 'Heartbeats', 'Logs', expect.stringMatching(/^\d*Alerts$/)]);
    expect(within(tabs).getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Projects' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'NexusWatch home' }).closest('header')).toHaveTextContent('Heartbeats');
  });

  it('marks the active tab', async () => {
    renderAt('/logs');
    const tabs = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(tabs).getByRole('link', { name: 'Logs' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('marks More as current for a page that lives in the sheet', async () => {
    renderAt('/settings');
    const more = await screen.findByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-current', 'page');
  });

  it('opens and closes the More sheet', async () => {
    renderAt('/');
    const more = await screen.findByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(more).toHaveAttribute('aria-controls', sheet.id);
    for (const page of ['Metrics', 'Settings']) expect(within(sheet).getByRole('link', { name: page })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /NexusInfra/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /FinVault/ })).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the sheet on Escape and returns focus to More', async () => {
    renderAt('/');
    const more = await screen.findByRole('button', { name: 'More' });
    more.focus();
    fireEvent.click(more);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it('closes the sheet when a page is picked', async () => {
    const router = renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Metrics' }));
    expect(router.state.location.pathname).toBe('/metrics');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Metrics' })).toBeInTheDocument();
  });

  it('moves log facets into a filter sheet and opens a tapped line full-screen', async () => {
    renderAt('/logs?q=prisma');
    const filters = await screen.findByRole('button', { name: /Fields & filters/ });
    expect(screen.queryByRole('complementary', { name: 'Fields' })).not.toBeInTheDocument();
    fireEvent.click(filters);
    expect(screen.getByRole('dialog', { name: 'Fields' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(await screen.findByRole('button', { name: /Prisma P1001/ }));
    const doc = screen.getByRole('dialog');
    expect(within(doc).getAllByText(/cannot reach database/).length).toBeGreaterThan(0);
    expect(within(doc).getByText('Document')).toBeInTheDocument();
    expect(within(doc).getByRole('link', { name: 'Open service →' })).toBeInTheDocument();
  });
});

describe('desktop shell', () => {
  beforeEach(() => stubNarrow(false));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the sidebar and has no tab bar', async () => {
    renderAt('/');
    expect(await screen.findByRole('navigation', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });
});

describe('trapIndex', () => {
  it('wraps Tab from the last element to the first and Shift+Tab the other way', () => {
    expect(trapIndex(3, 2, false)).toBe(0);
    expect(trapIndex(3, 0, true)).toBe(2);
  });
  it('leaves focus moves inside the trap to the browser', () => {
    expect(trapIndex(3, 0, false)).toBe(-1);
    expect(trapIndex(3, 2, true)).toBe(-1);
  });
  it('pulls focus back in when it is outside the trap', () => {
    expect(trapIndex(3, -1, false)).toBe(0);
    expect(trapIndex(3, -1, true)).toBe(2);
    expect(trapIndex(0, -1, false)).toBe(-1);
  });
});
