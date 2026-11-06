import { errorText, type Clock, type Task, type TaskStatus } from './types.js';

/** Runs each task on its own interval, never overlapping with itself, and remembers how it went. */
export class Scheduler {
  private readonly status = new Map<string, TaskStatus>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly running = new Set<string>();

  constructor(
    private readonly tasks: Task[],
    private readonly clock: Clock = Date.now,
    private readonly onError: (task: string, error: string) => void = () => {},
  ) {
    for (const t of tasks) this.status.set(t.name, { name: t.name, intervalMs: t.intervalMs, lastRunAt: null, lastOkAt: null, lastError: null });
  }

  /** Runs one task now. Resolves when it is done; a failure is recorded, never thrown. */
  async runTask(task: Task): Promise<void> {
    if (this.running.has(task.name)) return;
    this.running.add(task.name);
    const s = this.status.get(task.name)!;
    s.lastRunAt = new Date(this.clock()).toISOString();
    try {
      await task.run();
      s.lastOkAt = new Date(this.clock()).toISOString();
      s.lastError = null;
    } catch (err) {
      const text = errorText(err);
      if (s.lastError !== text) this.onError(task.name, text);
      s.lastError = text;
    } finally {
      this.running.delete(task.name);
    }
  }

  /** Runs every task once, now. */
  runAll(): Promise<void> {
    return Promise.all(this.tasks.map((t) => this.runTask(t))).then(() => undefined);
  }

  start(): void {
    void this.runAll();
    for (const t of this.tasks) this.timers.push(setInterval(() => void this.runTask(t), t.intervalMs));
  }

  stop(): void {
    this.timers.splice(0).forEach(clearInterval);
  }

  /** Lets other parts (the event bus) report into the same status list. */
  report(name: string, intervalMs: number, error: string | null): void {
    const now = new Date(this.clock()).toISOString();
    const s = this.status.get(name) ?? { name, intervalMs, lastRunAt: null, lastOkAt: null, lastError: null };
    s.lastRunAt = now;
    if (error) s.lastError = error;
    else {
      s.lastOkAt = now;
      s.lastError = null;
    }
    this.status.set(name, s);
  }

  snapshot(): TaskStatus[] {
    return [...this.status.values()].map((s) => ({ ...s }));
  }
}
