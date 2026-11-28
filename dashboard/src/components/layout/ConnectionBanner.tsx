/**
 * One line at the top while the collector does not answer (network error, nginx 502/504), instead of
 * every card failing on its own. The pages keep the data they last had; React Query keeps retrying.
 */
import { useNavCounts } from '@/api/queries';
import { ApiError } from '@/api/client';
import { formatClock } from '@/lib/format';

export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504);
}

export function ConnectionBanner() {
  const nav = useNavCounts();
  if (!nav.isError || !isUnreachable(nav.error)) return null;
  return (
    <div className="conn-banner" role="status">
      <strong>Collector unreachable.</strong>{' '}
      {nav.dataUpdatedAt ? `Showing data from ${formatClock(new Date(nav.dataUpdatedAt).toISOString(), 'min')}; retrying.` : 'Retrying.'}
    </div>
  );
}
