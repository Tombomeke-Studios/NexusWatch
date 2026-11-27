/**
 * Adding a monitor from the dashboard, pure: the one validator the form, the sample backend and the
 * collector use. The collector calls the URL every interval, so it gets the same host rules as a
 * notification target (no loopback, link-local or metadata address; the LAN and Docker names are fine).
 */
import type { NewMonitor, ProjectId } from '@/api/types';
import { isBlockedHost } from './channels';

export const MONITOR_INTERVALS = [15, 30, 60, 120, 300] as const;

export interface ValidMonitor {
  name: string;
  project: ProjectId;
  url: string;
  intervalSeconds: number;
}

export type MonitorValidation = { ok: true; value: ValidMonitor } | { ok: false; field: keyof NewMonitor; error: string };

export function validateMonitor(input: Partial<Record<keyof NewMonitor, unknown>>): MonitorValidation {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 60) return { ok: false, field: 'name', error: 'A name of 1–60 characters' };
  if (input.project !== 'nexusinfra' && input.project !== 'finvault') return { ok: false, field: 'project', error: 'NexusInfra or FinVault' };
  let url: URL | null;
  try {
    url = new URL(typeof input.url === 'string' ? input.url.trim() : '');
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol) || !url.hostname) return { ok: false, field: 'url', error: 'An http:// or https:// URL, e.g. http://my-service:8000/health' };
  if (isBlockedHost(url.hostname)) return { ok: false, field: 'url', error: 'A local or metadata address is not allowed — use the container name or host.docker.internal' };
  const intervalSeconds = input.intervalSeconds === undefined ? 30 : Number(input.intervalSeconds);
  if (!MONITOR_INTERVALS.includes(intervalSeconds as (typeof MONITOR_INTERVALS)[number])) return { ok: false, field: 'intervalSeconds', error: `One of ${MONITOR_INTERVALS.join(', ')} seconds` };
  return { ok: true, value: { name, project: input.project, url: url.toString(), intervalSeconds } };
}

/** A stable id for a new monitor, unique among `taken`: `m-<slug>`, `m-<slug>-2`, … */
export function monitorId(name: string, taken: readonly string[]): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'monitor';
  let id = `m-${slug}`;
  for (let n = 2; taken.includes(id); n++) id = `m-${slug}-${n}`;
  return id;
}
