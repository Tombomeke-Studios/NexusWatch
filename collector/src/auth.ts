/**
 * Optional dashboard login: one password (`NW_DASHBOARD_PASSWORD`). Without it the API is open, as
 * before — fine on a trusted LAN, not once anything else can reach the port.
 *
 * - A login answers with an HttpOnly, SameSite=Strict session cookie; only its SHA-256 hash is stored
 *   (SQLite, so a restart keeps people logged in). Sessions last 30 days.
 * - Wrong passwords are limited per client address: 5 a minute, then 429.
 * - Public without a session: `GET /api/status` (the public status page), `/api/auth/*`, `/health`.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './routes.js';
import type { Store } from './store.js';
import type { Clock } from './sources/types.js';

export const SESSION_COOKIE = 'nw_session';
export const SESSION_TTL_MS = 30 * 24 * 3_600_000;
const SESSIONS = 'auth.sessions';
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 60_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function sameSecret(given: string, expected: string): boolean {
  // Hash both first, so the comparison is constant-time whatever the lengths.
  return timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());
}

/** Paths under /api that answer without a session. */
export function isPublic(method: string, path: string): boolean {
  return (method === 'GET' && path === '/status') || path === '/auth' || path.startsWith('/auth/');
}

/** The session token from a Cookie header, if any. */
export function sessionFrom(cookieHeader: string | undefined): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export class Auth {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly store: Store,
    private readonly password: string | null,
    private readonly clock: Clock,
  ) {}

  get required(): boolean {
    return this.password !== null;
  }

  private sessions(): Record<string, number> {
    const now = this.clock();
    const all = this.store.get<Record<string, number>>(SESSIONS) ?? {};
    return Object.fromEntries(Object.entries(all).filter(([, expires]) => expires > now));
  }

  /** Whether a request with this token may use the API. */
  allows(token: string | null): boolean {
    if (!this.required) return true;
    return token !== null && hash(token) in this.sessions();
  }

  /** Checks the password; returns a new session token. 401 when wrong, 429 after too many tries. */
  login(password: unknown, client: string): string {
    if (!this.password) throw new HttpError(400, 'No dashboard password is set');
    const now = this.clock();
    const recent = (this.failures.get(client) ?? []).filter((t) => t > now - FAILURE_WINDOW_MS);
    if (recent.length >= MAX_FAILURES) throw new HttpError(429, 'Too many attempts — wait a minute');
    if (typeof password !== 'string' || !sameSecret(password, this.password)) {
      this.failures.set(client, [...recent, now]);
      throw new HttpError(401, 'Wrong password');
    }
    this.failures.delete(client);
    const token = randomBytes(32).toString('base64url');
    this.store.set(SESSIONS, { ...this.sessions(), [hash(token)]: now + SESSION_TTL_MS });
    return token;
  }

  logout(token: string | null): void {
    if (!token) return;
    const next = this.sessions();
    delete next[hash(token)];
    this.store.set(SESSIONS, next);
  }
}
