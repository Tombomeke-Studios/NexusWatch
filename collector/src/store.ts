/**
 * Storage: one SQLite file (Node's built-in `node:sqlite`, so there is no native module to build).
 *
 * What is kept, and under which retention kind (Settings → Retention):
 * - logs        — every log line the collector writes or receives, with a stored, stable id
 * - metrics     — numeric samples per metric and series (`cpu` / `node-01`, `requests` / `rps`, …)
 * - heartbeats  — every health check (status + latency, null when there was no answer),
 *                 the incidents they open, and the last-known state of heartbeat sources
 * Plus a small key/value table for what the dashboard writes: settings, acknowledgements, rule toggles.
 * The schema is created here on start; there is no separate migration step yet.
 */
import { mkdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HealthStatus, LogEntry, LogLevel, ProjectId, Severity } from './contract.js';

export type RetentionKind = 'logs' | 'metrics' | 'heartbeats';

export interface Check {
  ts: number;
  status: HealthStatus;
  /** null = no answer (timeout, refused, non-2xx). Never 0. */
  latencyMs: number | null;
  note: string;
}

export interface Sample {
  series: string;
  ts: number;
  value: number;
}

export type SourceKind = 'node' | 'service';

/** Last-known state of a heartbeat source (a node or a service on the event bus / Control Room). */
export interface SourceState {
  name: string;
  kind: SourceKind;
  status: HealthStatus;
  lastSeen: number;
  /** Uptime as reported by the Control Room; null when nobody measured it. */
  uptimePct: number | null;
  /** Where the state came from: `control-room` or `bus`. */
  origin: string;
  /** Extra facts, e.g. a node's resources from its heartbeat. */
  detail: Record<string, unknown>;
}

export interface IncidentRow {
  id: string;
  subject: string;
  project: ProjectId;
  severity: Severity;
  title: string;
  note: string;
  startedAt: number;
  endedAt: number | null;
}

export interface NewLog {
  ts: number;
  level: LogLevel;
  service: string;
  serviceId?: string;
  project: ProjectId;
  node: string;
  message: string;
  fields?: Record<string, string | number | boolean>;
}

export interface LogFilter {
  from: number;
  to: number;
  text?: string;
  levels?: LogLevel[];
  project?: ProjectId;
  serviceId?: string;
}

type Row = Record<string, unknown>;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY, ts INTEGER NOT NULL, level TEXT NOT NULL, service TEXT NOT NULL, service_id TEXT,
    project TEXT NOT NULL, node TEXT NOT NULL, message TEXT NOT NULL, fields TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS logs_ts ON logs (ts);
  CREATE INDEX IF NOT EXISTS logs_service ON logs (service_id, ts);
  CREATE TABLE IF NOT EXISTS checks (target TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL, latency_ms REAL, note TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS checks_target ON checks (target, ts);
  CREATE TABLE IF NOT EXISTS samples (metric TEXT NOT NULL, series TEXT NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL);
  CREATE INDEX IF NOT EXISTS samples_metric ON samples (metric, ts);
  CREATE TABLE IF NOT EXISTS sources (
    name TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, last_seen INTEGER NOT NULL,
    uptime_pct REAL, origin TEXT NOT NULL, detail TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY, subject TEXT NOT NULL, project TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL,
    note TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/** Tables per retention kind — what `prune` deletes from and `usage` measures. */
const TABLES: Record<RetentionKind, string[]> = { logs: ['logs'], metrics: ['samples'], heartbeats: ['checks', 'incidents', 'sources'] };

/** Sortable, unique and stored — so a line keeps its id across polls, endpoints and restarts. */
function newId(prefix: string, ts: number): string {
  return `${prefix}_${ts.toString(36)}${randomBytes(4).toString('hex')}`;
}

function toLog(r: Row): LogEntry {
  return {
    id: r.id as string,
    time: new Date(r.ts as number).toISOString(),
    level: r.level as LogLevel,
    service: r.service as string,
    ...(r.service_id ? { serviceId: r.service_id as string } : {}),
    project: r.project as ProjectId,
    node: r.node as string,
    message: r.message as string,
    fields: JSON.parse(r.fields as string),
  };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(readonly path: string = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ── Logs ─────────────────────────────────────────────────────────────
  addLog(log: NewLog): LogEntry {
    const id = newId('log', log.ts);
    const fields = { level: log.level, service: log.service, project: log.project, message: log.message, node: log.node, ...log.fields };
    this.db
      .prepare('INSERT INTO logs (id, ts, level, service, service_id, project, node, message, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, log.ts, log.level, log.service, log.serviceId ?? null, log.project, log.node, log.message, JSON.stringify(fields));
    return toLog({ id, ts: log.ts, level: log.level, service: log.service, service_id: log.serviceId, project: log.project, node: log.node, message: log.message, fields: JSON.stringify(fields) });
  }

  private logWhere(f: LogFilter, opts: { ignoreLevels?: boolean } = {}): { sql: string; args: (string | number)[] } {
    const parts = ['ts >= ?', 'ts <= ?'];
    const args: (string | number)[] = [f.from, f.to];
    if (f.text?.trim()) {
      // A literal substring match: % and _ in the query are escaped, not wildcards.
      const like = `%${f.text.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      parts.push("(lower(message) LIKE ? ESCAPE '\\' OR lower(service) LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
    if (!opts.ignoreLevels && f.levels?.length) {
      parts.push(`level IN (${f.levels.map(() => '?').join(',')})`);
      args.push(...f.levels);
    }
    if (f.project) {
      parts.push('project = ?');
      args.push(f.project);
    }
    if (f.serviceId) {
      parts.push('service_id = ?');
      args.push(f.serviceId);
    }
    return { sql: parts.join(' AND '), args };
  }

  /** Newest first. */
  logs(f: LogFilter, limit = 200): LogEntry[] {
    const { sql, args } = this.logWhere(f);
    return this.db.prepare(`SELECT * FROM logs WHERE ${sql} ORDER BY ts DESC, id DESC LIMIT ?`).all(...args, limit).map(toLog);
  }

  countLogs(f: LogFilter): number {
    const { sql, args } = this.logWhere(f);
    return Number((this.db.prepare(`SELECT count(*) n FROM logs WHERE ${sql}`).get(...args) as Row).n);
  }

  /** Counts per value of `column` — level counts ignore the level filter so every level stays visible. */
  logFacet(f: LogFilter, column: 'level' | 'service' | 'node'): { value: string; count: number }[] {
    const { sql, args } = this.logWhere(f, { ignoreLevels: column === 'level' });
    return this.db
      .prepare(`SELECT ${column} value, count(*) count FROM logs WHERE ${sql} GROUP BY ${column} ORDER BY count DESC, value LIMIT 20`)
      .all(...args)
      .map((r) => ({ value: r.value as string, count: Number(r.count) }));
  }

  /** Error and warn counts in `buckets` equal slices of [from, to], oldest first. */
  logHistogram(f: LogFilter, buckets: number): { error: number; warn: number }[] {
    const out = Array.from({ length: buckets }, () => ({ error: 0, warn: 0 }));
    const { sql, args } = this.logWhere({ ...f, levels: ['error', 'warn'] });
    const width = (f.to - f.from) / buckets;
    const rows = this.db.prepare(`SELECT ts, level FROM logs WHERE ${sql}`).all(...args);
    for (const r of rows) {
      const i = Math.min(buckets - 1, Math.floor(((r.ts as number) - f.from) / width));
      out[i][r.level as 'error' | 'warn']++;
    }
    return out;
  }

  // ── Checks ───────────────────────────────────────────────────────────
  addCheck(target: string, check: Check): void {
    this.db.prepare('INSERT INTO checks (target, ts, status, latency_ms, note) VALUES (?, ?, ?, ?, ?)').run(target, check.ts, check.status, check.latencyMs, check.note);
  }

  /** Checks for `target` since `from`, oldest first. */
  checks(target: string, from = 0): Check[] {
    return this.db
      .prepare('SELECT ts, status, latency_ms, note FROM checks WHERE target = ? AND ts >= ? ORDER BY ts')
      .all(target, from)
      .map((r) => ({ ts: r.ts as number, status: r.status as HealthStatus, latencyMs: r.latency_ms as number | null, note: r.note as string }));
  }

  /** The newest `n` checks for `target`, oldest first. */
  lastChecks(target: string, n: number): Check[] {
    return this.db
      .prepare('SELECT ts, status, latency_ms, note FROM checks WHERE target = ? ORDER BY ts DESC LIMIT ?')
      .all(target, n)
      .map((r) => ({ ts: r.ts as number, status: r.status as HealthStatus, latencyMs: r.latency_ms as number | null, note: r.note as string }))
      .reverse();
  }

  firstCheckAt(target: string): number | null {
    const r = this.db.prepare('SELECT min(ts) ts FROM checks WHERE target = ?').get(target) as Row;
    return (r.ts as number | null) ?? null;
  }

  // ── Samples ──────────────────────────────────────────────────────────
  addSample(metric: string, series: string, ts: number, value: number): void {
    if (!Number.isFinite(value)) return; // NaN / Inf are not measurements
    this.db.prepare('INSERT INTO samples (metric, series, ts, value) VALUES (?, ?, ?, ?)').run(metric, series, ts, value);
  }

  /** Samples of `metric` in [from, to], oldest first. */
  samples(metric: string, from: number, to: number): Sample[] {
    return this.db
      .prepare('SELECT series, ts, value FROM samples WHERE metric = ? AND ts >= ? AND ts <= ? ORDER BY ts')
      .all(metric, from, to)
      .map((r) => ({ series: r.series as string, ts: r.ts as number, value: r.value as number }));
  }

  hasSamples(metric: string): boolean {
    return this.db.prepare('SELECT 1 FROM samples WHERE metric = ? LIMIT 1').get(metric) !== undefined;
  }

  /** Newest value per series of `metric`. */
  latestSamples(metric: string): Sample[] {
    return this.db
      .prepare('SELECT s.series, s.ts, s.value FROM samples s JOIN (SELECT series, max(ts) ts FROM samples WHERE metric = ? GROUP BY series) m ON s.series = m.series AND s.ts = m.ts WHERE s.metric = ? ORDER BY s.series')
      .all(metric, metric)
      .map((r) => ({ series: r.series as string, ts: r.ts as number, value: r.value as number }));
  }

  // ── Heartbeat sources ────────────────────────────────────────────────
  upsertSource(s: SourceState): void {
    this.db
      .prepare(
        `INSERT INTO sources (name, kind, status, last_seen, uptime_pct, origin, detail) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, status = excluded.status, last_seen = excluded.last_seen,
           uptime_pct = coalesce(excluded.uptime_pct, sources.uptime_pct), origin = excluded.origin,
           detail = json_patch(sources.detail, excluded.detail)`,
      )
      .run(s.name, s.kind, s.status, s.lastSeen, s.uptimePct, s.origin, JSON.stringify(s.detail));
  }

  source(name: string): SourceState | null {
    const r = this.db.prepare('SELECT * FROM sources WHERE name = ?').get(name) as Row | undefined;
    return r ? this.toSource(r) : null;
  }

  sources(kind?: SourceKind): SourceState[] {
    const rows = kind ? this.db.prepare('SELECT * FROM sources WHERE kind = ? ORDER BY name').all(kind) : this.db.prepare('SELECT * FROM sources ORDER BY name').all();
    return rows.map((r) => this.toSource(r));
  }

  private toSource(r: Row): SourceState {
    return {
      name: r.name as string,
      kind: r.kind as SourceKind,
      status: r.status as HealthStatus,
      lastSeen: r.last_seen as number,
      uptimePct: r.uptime_pct as number | null,
      origin: r.origin as string,
      detail: JSON.parse(r.detail as string),
    };
  }

  // ── Incidents ────────────────────────────────────────────────────────
  openIncident(i: Omit<IncidentRow, 'id' | 'endedAt'>): IncidentRow {
    const id = newId('inc', i.startedAt);
    this.db
      .prepare('INSERT INTO incidents (id, subject, project, severity, title, note, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
      .run(id, i.subject, i.project, i.severity, i.title, i.note, i.startedAt);
    return { ...i, id, endedAt: null };
  }

  closeIncidents(subject: string, at: number): number {
    return Number(this.db.prepare('UPDATE incidents SET ended_at = ? WHERE subject = ? AND ended_at IS NULL').run(at, subject).changes);
  }

  openIncidentFor(subject: string): IncidentRow | null {
    const r = this.db.prepare('SELECT * FROM incidents WHERE subject = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(subject) as Row | undefined;
    return r ? this.toIncident(r) : null;
  }

  /** Newest first: open ones, and closed ones that ended after `since`. */
  incidents(since = 0, subject?: string): IncidentRow[] {
    const rows = subject
      ? this.db.prepare('SELECT * FROM incidents WHERE subject = ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY started_at DESC').all(subject, since)
      : this.db.prepare('SELECT * FROM incidents WHERE ended_at IS NULL OR ended_at >= ? ORDER BY started_at DESC').all(since);
    return rows.map((r) => this.toIncident(r));
  }

  hasIncidentHistory(): boolean {
    return this.db.prepare('SELECT 1 FROM incidents LIMIT 1').get() !== undefined;
  }

  private toIncident(r: Row): IncidentRow {
    return {
      id: r.id as string,
      subject: r.subject as string,
      project: r.project as ProjectId,
      severity: r.severity as Severity,
      title: r.title as string,
      note: r.note as string,
      startedAt: r.started_at as number,
      endedAt: (r.ended_at as number | null) ?? null,
    };
  }

  // ── Key/value ────────────────────────────────────────────────────────
  get<T>(key: string): T | undefined {
    const r = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as Row | undefined;
    return r ? (JSON.parse(r.value as string) as T) : undefined;
  }

  set(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  // ── Retention ────────────────────────────────────────────────────────
  /** Deletes everything older than its kind's retention. Open incidents are never pruned. */
  prune(retentionMs: Record<RetentionKind, number>, now: number): Record<RetentionKind, number> {
    const cut = (kind: RetentionKind) => now - retentionMs[kind];
    const n = (sql: string, ...args: number[]) => Number(this.db.prepare(sql).run(...args).changes);
    return {
      logs: n('DELETE FROM logs WHERE ts < ?', cut('logs')),
      metrics: n('DELETE FROM samples WHERE ts < ?', cut('metrics')),
      heartbeats:
        n('DELETE FROM checks WHERE ts < ?', cut('heartbeats')) +
        n('DELETE FROM incidents WHERE ended_at IS NOT NULL AND ended_at < ?', cut('heartbeats')) +
        n('DELETE FROM sources WHERE last_seen < ?', cut('heartbeats')),
    };
  }

  /** Bytes on disk per retention kind (SQLite's dbstat; table pages including their indexes). */
  usage(): { perKind: Record<RetentionKind, number>; fileBytes: number } {
    const perTable = new Map<string, number>();
    try {
      for (const r of this.db.prepare('SELECT tbl_name name, sum(pgsize) bytes FROM dbstat JOIN sqlite_schema USING (name) GROUP BY tbl_name').all()) {
        perTable.set(r.name as string, Number(r.bytes));
      }
    } catch {
      // dbstat is not compiled into every SQLite build; usage then reads as 0 per kind.
    }
    const perKind = Object.fromEntries(
      (Object.keys(TABLES) as RetentionKind[]).map((k) => [k, TABLES[k].reduce((sum, t) => sum + (perTable.get(t) ?? 0), 0)]),
    ) as Record<RetentionKind, number>;
    let fileBytes = 0;
    if (this.path !== ':memory:') {
      for (const suffix of ['', '-wal']) {
        try {
          fileBytes += statSync(this.path + suffix).size;
        } catch {
          // no WAL file yet
        }
      }
    } else {
      fileBytes = [...perTable.values()].reduce((a, b) => a + b, 0);
    }
    return { perKind, fileBytes };
  }
}
