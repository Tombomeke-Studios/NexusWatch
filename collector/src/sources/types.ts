/** What every source adapter shares: an injectable fetch and clock, so each is testable without a network. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type Clock = () => number;

/** One periodic job (a health target, a Control Room poll, one scrape target). */
export interface Task {
  name: string;
  intervalMs: number;
  run(): Promise<void>;
}

/** Shown by the collector's own `/health`. */
export interface TaskStatus {
  name: string;
  intervalMs: number;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

export function errorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timed out';
    const code = (err.cause as { code?: string } | undefined)?.code;
    return code ? `${code} ${err.message}` : err.message;
  }
  return String(err);
}
