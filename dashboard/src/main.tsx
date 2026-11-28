import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { ThemeProvider } from './theme';
import { App } from './App';
import { registerServiceWorker } from './pwa';
import './styles/tokens.css';
import './styles/app.css';

// A 401 anywhere means the session ended (logged out elsewhere, expired): ask again who we are.
const onError = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401) void queryClient.invalidateQueries({ queryKey: ['auth'] });
};

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    // A 401 is not worth retrying.
    queries: { staleTime: 5_000, retry: (n, err) => !(err instanceof ApiError && err.status === 401) && n < 1, refetchOnWindowFocus: true },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);

registerServiceWorker();
