import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '@/api/client';

/**
 * Renders a query's three states the same way everywhere:
 * skeleton while loading, a message on error, `children(data)` once there is data.
 */
export function QueryState<T>({ query, children, skeletonHeight = 320 }: { query: UseQueryResult<T>; children: (data: T) => ReactNode; skeletonHeight?: number }) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <div className="skeleton" style={{ minHeight: skeletonHeight }} aria-busy="true" aria-label="Loading" />;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  const message = notFound ? 'Not found.' : error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="box state error" role="alert">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{notFound ? 'Nothing here' : 'Could not load data'}</div>
      <div className="muted small" style={{ marginBottom: onRetry && !notFound ? 12 : 0 }}>{message}</div>
      {onRetry && !notFound && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}
