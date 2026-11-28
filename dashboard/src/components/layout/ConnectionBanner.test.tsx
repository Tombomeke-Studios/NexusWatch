import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { ConnectionBanner, isUnreachable } from './ConnectionBanner';

afterEach(() => vi.restoreAllMocks());

const renderBanner = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConnectionBanner />
    </QueryClientProvider>,
  );

describe('ConnectionBanner', () => {
  it('counts no answer and a gateway error as unreachable, not a 404 or 401', () => {
    expect(isUnreachable(new ApiError(0, 'x'))).toBe(true);
    expect(isUnreachable(new ApiError(502, 'x'))).toBe(true);
    expect(isUnreachable(new ApiError(404, 'x'))).toBe(false);
    expect(isUnreachable(new ApiError(401, 'x'))).toBe(false);
  });

  it('says so once when the collector does not answer, and stays away when it does', async () => {
    vi.spyOn(api, 'navCounts').mockRejectedValue(new ApiError(0, 'Failed to fetch'));
    renderBanner();
    expect(await screen.findByRole('status')).toHaveTextContent('Collector unreachable.');
  });
});
