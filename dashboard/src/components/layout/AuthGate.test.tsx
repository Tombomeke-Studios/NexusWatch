import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { AuthGate } from './AuthGate';

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <h1>The app</h1>
      </AuthGate>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('AuthGate', () => {
  it('shows the app when no login is required', async () => {
    vi.spyOn(api, 'auth').mockResolvedValue({ required: false, authenticated: true });
    renderGate();
    expect(await screen.findByRole('heading', { name: 'The app' })).toBeInTheDocument();
  });

  it('asks for the password, says when it is wrong, and opens the app after logging in', async () => {
    let loggedIn = false;
    vi.spyOn(api, 'auth').mockImplementation(async () => ({ required: true, authenticated: loggedIn }));
    const login = vi.spyOn(api, 'login').mockImplementation(async (pw) => {
      if (pw !== 'correct horse') throw new ApiError(401, 'Wrong password');
      loggedIn = true;
    });
    renderGate();
    const field = await screen.findByLabelText('Password');
    expect(screen.queryByRole('heading', { name: 'The app' })).toBeNull();

    fireEvent.change(field, { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password');

    fireEvent.change(field, { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'The app' })).toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(2);
  });
});
