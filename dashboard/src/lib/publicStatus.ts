/** Public status page roll-up. Pure and tested; the mock and (later) the backend both use these rules. */
import type { HealthStatus, PublicStatus } from '@/api/types';

/** A component's public status from its internal health. */
export function toPublicStatus(status: HealthStatus): PublicStatus {
  return status === 'up' ? 'operational' : status === 'slow' ? 'degraded' : 'major-outage';
}

/** Worst first, for picking the status of a group of components (e.g. several nodes as one). */
const RANK: Record<PublicStatus, number> = { 'major-outage': 4, 'partial-outage': 3, degraded: 2, maintenance: 1, operational: 0 };

export function worstStatus(statuses: readonly PublicStatus[]): PublicStatus {
  return statuses.reduce<PublicStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'operational');
}

/**
 * Overall banner: a major outage only when at least half of all components are down, a partial
 * outage when any is, then degraded, then maintenance in progress, else operational.
 */
export function overallStatus(statuses: readonly PublicStatus[], maintenanceInProgress = false): PublicStatus {
  const down = statuses.filter((s) => s === 'major-outage' || s === 'partial-outage').length;
  if (down > 0 && down * 2 >= statuses.length) return 'major-outage';
  if (down > 0) return 'partial-outage';
  if (statuses.includes('degraded')) return 'degraded';
  if (maintenanceInProgress || statuses.includes('maintenance')) return 'maintenance';
  return 'operational';
}
