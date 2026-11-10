/**
 * Collector configuration from environment variables. Every source is off until its variable is
 * set; a part of the API with no source is served from the dashboard's sample data.
 * The full list, with examples, is in the repo's .env.example.
 */
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import type { ProjectId } from './contract.js';
import type { NotifyTargets } from './notify/channels.js';

export interface HealthTarget {
  /** Service id used in the API (`/services/:id`), e.g. `nx-control-room`. */
  id: string;
  name: string;
  project: ProjectId;
  /** URL that answers 2xx when healthy, e.g. `http://control-room:9000/health`. */
  url: string;
  /** Shown in the UI; derived from the URL when absent (`:9000`). */
  port: string;
  intervalMs: number;
  timeoutMs: number;
}

export interface MetricsTarget {
  /** Service label for the scrape, e.g. `orchestrator`. */
  name: string;
  url: string;
}

export interface Config {
  port: number;
  dbPath: string;
  host: { name: string; address: string | null };
  health: { targets: HealthTarget[]; slowMs: number; failuresForIncident: number };
  controlRoom: { url: string; intervalMs: number; nodePattern: RegExp } | null;
  metrics: { targets: MetricsTarget[]; intervalMs: number; token: string | undefined };
  bus: { url: string; queue: string } | null;
  pruneIntervalMs: number;
  /** How often alert rules are evaluated against the stored measurements. */
  rulesIntervalMs: number;
  /** Where notifications go. A channel without its variable(s) is off. */
  notify: { targets: NotifyTargets; intervalMs: number; timeoutMs: number; publicUrl: string | null };
}

type Env = Record<string, string | undefined>;

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number, got "${raw}"`);
  return n;
}

const PROJECTS: ProjectId[] = ['nexusinfra', 'finvault'];

function parseTargets(json: string, source: string, intervalMs: number, timeoutMs: number): HealthTarget[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`${source} is not valid JSON: ${err instanceof Error ? err.message : err}`, { cause: err });
  }
  if (!Array.isArray(raw)) throw new Error(`${source} must be a JSON array of health targets`);
  const seen = new Set<string>();
  return raw.map((t: Record<string, unknown>, i) => {
    const where = `${source}[${i}]`;
    for (const k of ['id', 'name', 'project', 'url'] as const) {
      if (typeof t[k] !== 'string' || !t[k]) throw new Error(`${where}.${k} is required`);
    }
    const project = t.project as ProjectId;
    if (!PROJECTS.includes(project)) throw new Error(`${where}.project must be one of ${PROJECTS.join(', ')}`);
    const id = t.id as string;
    if (seen.has(id)) throw new Error(`${where}.id "${id}" is used twice`);
    seen.add(id);
    const url = new URL(t.url as string);
    const port = typeof t.port === 'string' ? t.port : `:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
    return {
      id,
      name: t.name as string,
      project,
      url: url.toString(),
      port,
      intervalMs: typeof t.intervalMs === 'number' ? t.intervalMs : intervalMs,
      timeoutMs: typeof t.timeoutMs === 'number' ? t.timeoutMs : timeoutMs,
    };
  });
}

/** `name=url,name=url` → scrape targets. */
function parseMetricsTargets(list: string): MetricsTarget[] {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf('=');
      if (eq <= 0) throw new Error(`NW_METRICS_TARGETS entry "${entry}" must look like name=http://host:port/metrics`);
      return { name: entry.slice(0, eq).trim(), url: new URL(entry.slice(eq + 1).trim()).toString() };
    });
}

/** Only http(s), and no credentials in the URL: they would end up in logs. */
function httpUrl(raw: string, key: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key} must be a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${key} must be an http(s) URL`);
  return url;
}

function notifyTargets(env: Env): NotifyTargets {
  let discord: NotifyTargets['discord'] = null;
  if (env.NW_DISCORD_WEBHOOK_URL) {
    const url = httpUrl(env.NW_DISCORD_WEBHOOK_URL, 'NW_DISCORD_WEBHOOK_URL');
    const host = url.hostname;
    if (url.protocol !== 'https:' || !(host === 'discord.com' || host === 'discordapp.com' || host.endsWith('.discord.com')) || !url.pathname.startsWith('/api/webhooks/')) {
      throw new Error('NW_DISCORD_WEBHOOK_URL must look like https://discord.com/api/webhooks/<id>/<token>');
    }
    discord = { url: url.toString() };
  }

  const { NW_TELEGRAM_BOT_TOKEN: token, NW_TELEGRAM_CHAT_ID: chatId } = env;
  if (Boolean(token) !== Boolean(chatId)) throw new Error('NW_TELEGRAM_BOT_TOKEN and NW_TELEGRAM_CHAT_ID must be set together');
  if (token && !/^\d+:[\w-]+$/.test(token)) throw new Error('NW_TELEGRAM_BOT_TOKEN must look like 123456:ABC-DEF');

  let push: NotifyTargets['push'] = null;
  if (env.NW_NTFY_URL) {
    const url = httpUrl(env.NW_NTFY_URL, 'NW_NTFY_URL');
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) throw new Error('NW_NTFY_URL must be the server plus one topic, e.g. https://ntfy.sh/my-topic');
    push = { server: `${url.origin}/`, topic: decodeURIComponent(segments[0]), token: env.NW_NTFY_TOKEN || undefined };
  }

  const mail = [env.NW_SMTP_URL, env.NW_EMAIL_FROM, env.NW_EMAIL_TO];
  if (mail.some(Boolean) && !mail.every(Boolean)) throw new Error('NW_SMTP_URL, NW_EMAIL_FROM and NW_EMAIL_TO must be set together');
  if (env.NW_SMTP_URL && !/^smtps?:\/\//.test(env.NW_SMTP_URL)) throw new Error('NW_SMTP_URL must start with smtp:// or smtps://');

  return {
    discord,
    telegram: token && chatId ? { token, chatId } : null,
    push,
    email: env.NW_SMTP_URL ? { smtpUrl: env.NW_SMTP_URL, from: env.NW_EMAIL_FROM as string, to: env.NW_EMAIL_TO as string } : null,
  };
}

export function loadConfig(env: Env = process.env, readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): Config {
  const intervalMs = num(env, 'NW_HEALTH_INTERVAL_MS', 30_000);
  const timeoutMs = num(env, 'NW_HEALTH_TIMEOUT_MS', 5_000);
  const targets = env.NW_HEALTH_TARGETS
    ? parseTargets(env.NW_HEALTH_TARGETS, 'NW_HEALTH_TARGETS', intervalMs, timeoutMs)
    : env.NW_HEALTH_TARGETS_FILE
      ? parseTargets(readFile(env.NW_HEALTH_TARGETS_FILE), env.NW_HEALTH_TARGETS_FILE, intervalMs, timeoutMs)
      : [];

  return {
    port: num(env, 'NW_PORT', 8080),
    dbPath: env.NW_DB_PATH || 'data/nexuswatch.db',
    host: { name: env.NW_HOST_NAME || hostname(), address: env.NW_HOST_ADDRESS || null },
    health: {
      targets,
      slowMs: num(env, 'NW_HEALTH_SLOW_MS', 100),
      failuresForIncident: Math.max(1, num(env, 'NW_HEALTH_FAILURES_FOR_INCIDENT', 3)),
    },
    controlRoom: env.NW_CONTROL_ROOM_URL
      ? {
          url: env.NW_CONTROL_ROOM_URL.replace(/\/$/, ''),
          intervalMs: num(env, 'NW_CONTROL_ROOM_INTERVAL_MS', 10_000),
          nodePattern: new RegExp(env.NW_NODE_PATTERN || '^node-'),
        }
      : null,
    metrics: {
      targets: env.NW_METRICS_TARGETS ? parseMetricsTargets(env.NW_METRICS_TARGETS) : [],
      intervalMs: num(env, 'NW_METRICS_INTERVAL_MS', 15_000),
      token: env.NW_METRICS_TOKEN || undefined,
    },
    bus: env.NW_RABBITMQ_URL ? { url: env.NW_RABBITMQ_URL, queue: env.NW_RABBITMQ_QUEUE || 'nexuswatch.collector' } : null,
    pruneIntervalMs: num(env, 'NW_PRUNE_INTERVAL_MS', 3_600_000),
    rulesIntervalMs: Math.max(1_000, num(env, 'NW_RULES_INTERVAL_MS', 15_000)),
    notify: {
      targets: notifyTargets(env),
      intervalMs: Math.max(1_000, num(env, 'NW_NOTIFY_INTERVAL_MS', 10_000)),
      timeoutMs: num(env, 'NW_NOTIFY_TIMEOUT_MS', 10_000),
      publicUrl: env.NW_PUBLIC_URL ? httpUrl(env.NW_PUBLIC_URL, 'NW_PUBLIC_URL').toString().replace(/\/$/, '') : null,
    },
  };
}
