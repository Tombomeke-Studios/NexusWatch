/**
 * Heartbeat sources (nodes and services on the event bus, as seen directly or through the
 * Control Room). Their status is derived from how long ago they were last seen, with the
 * Control Room's own thresholds (services/control-room/src/monitor.ts), so both origins agree.
 */
import type { HealthStatus, ProjectId } from '../contract.js';
import type { SourceKind, SourceState, Store } from '../store.js';

export const DEGRADED_MS = 3000;
export const OFFLINE_MS = 10000;

export function statusFromAge(lastSeen: number, now: number): HealthStatus {
  const age = now - lastSeen;
  if (age >= OFFLINE_MS) return 'down';
  if (age >= DEGRADED_MS) return 'slow';
  return 'up';
}

/** Control Room status words → the dashboard's. */
export function fromControlRoom(status: string): HealthStatus {
  return status === 'healthy' ? 'up' : status === 'degraded' ? 'slow' : 'down';
}

const subjectOf = (name: string) => `source:${name}`;

/**
 * Records a source's state and writes a log line / incident when its status changes.
 * Both the Control Room poller and the bus consumer go through here.
 */
export function recordSource(store: Store, next: SourceState, now: number, project: ProjectId = 'nexusinfra'): void {
  const before = store.source(next.name);
  store.upsertSource(next);
  const was = before?.status;
  if (was === next.status) return;

  const label = next.kind === 'node' ? `node ${next.name}` : next.name;
  const node = next.kind === 'node' ? next.name : next.origin;
  const log = (level: 'error' | 'warn' | 'ok' | 'info', message: string) =>
    store.addLog({ ts: now, level, service: next.kind === 'node' ? 'node-agent' : next.name, project, node, message, fields: { source: next.name, kind: next.kind, origin: next.origin } });

  if (next.status === 'down') {
    log('error', `${label} stopped sending heartbeats`);
    if (!store.openIncidentFor(subjectOf(next.name))) {
      store.openIncident({
        subject: subjectOf(next.name),
        project,
        severity: 'critical',
        title: next.kind === 'node' ? `${label} offline` : `${label} heartbeat lost`,
        note: `No heartbeat for ${Math.round((now - next.lastSeen) / 1000)} s (reported by ${next.origin}).`,
        startedAt: next.lastSeen,
      });
    }
    return;
  }
  if (next.status === 'slow') log('warn', `${label} heartbeat delayed`);
  else if (was) log('ok', `${label} heartbeat is back`);
  else log('info', `${label} first seen (${next.origin})`);
  store.closeIncidents(subjectOf(next.name), now);
}

/**
 * Every source of `kind` as of `now`. A source heard directly on the bus ages by the clock; one
 * reported by the Control Room keeps the status of the last poll (its `lastSeen` is only as fresh
 * as that poll, so ageing it here would flap between polls).
 */
export function liveSources(store: Store, kind: SourceKind, now: number): SourceState[] {
  return store.sources(kind).map((s) => (s.origin === 'bus' ? { ...s, status: statusFromAge(s.lastSeen, now) } : s));
}

/** Re-derives the status of bus sources by age, so a source that goes quiet is logged and opens an incident. */
export function evaluateBusSources(store: Store, now: number): void {
  for (const s of store.sources()) {
    if (s.origin !== 'bus') continue;
    const status = statusFromAge(s.lastSeen, now);
    if (status !== s.status) recordSource(store, { ...s, status, detail: {} }, now);
  }
}
