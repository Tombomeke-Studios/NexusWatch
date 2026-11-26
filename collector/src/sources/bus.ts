/**
 * RabbitMQ consumer for `monitoring.heartbeat.#` on the shared `finvault.events` exchange, plus the
 * business events (`sources/business.ts`) when a recorder is given.
 *
 * Read-only by design: the exchange is only *checked* (never declared, never renamed — NexusInfra
 * and FinVault own it); NexusWatch binds its own exclusive, auto-deleting queue, so nothing is left
 * on the broker when the collector stops and no other consumer loses a message.
 * Payloads are read with `readPayload()` (they may be AES-256-GCM encrypted).
 */
import type { Store } from '../store.js';
import { BUSINESS_BINDINGS, type BusinessRecorder } from './business.js';
import { recordSource } from './heartbeat.js';
import { readPayload, type EventEnvelope } from './payload.js';
import type { Clock } from './types.js';

/** Never rename: this is FinVault's exchange, shared with NexusInfra. */
export const EXCHANGE = 'finvault.events';
export const BINDING = 'monitoring.heartbeat.#';

interface NodeResources {
  cpuPercent?: number;
  ramUsedMb?: number;
  ramTotalMb?: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
  cpuCores?: number;
}

/** The part of an amqplib channel the consumer uses — small, so tests need no broker. */
export interface BusChannel {
  checkExchange(name: string): Promise<unknown>;
  assertQueue(name: string, options: { exclusive: boolean; autoDelete: boolean; durable: boolean }): Promise<{ queue: string }>;
  bindQueue(queue: string, exchange: string, pattern: string): Promise<unknown>;
  consume(queue: string, onMessage: (msg: { content: Buffer; fields: { routingKey: string } } | null) => void, options: { noAck: boolean }): Promise<unknown>;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export class HeartbeatConsumer {
  /** Last payload error per source, so a wrong key logs once instead of once a second. */
  private readonly lastError = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly messageKey: string | undefined = process.env.FINVAULT_MESSAGE_KEY,
    private readonly business: BusinessRecorder | null = null,
  ) {}

  /** Every routing key the queue is bound to. */
  bindings(): string[] {
    return [BINDING, ...(this.business ? BUSINESS_BINDINGS : [])];
  }

  /** Handles one message. Never throws: a bad message is logged, not retried. */
  handle(routingKey: string, content: Buffer): void {
    const now = this.clock();
    this.business?.heard(now);
    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(content.toString('utf8')) as EventEnvelope;
    } catch {
      this.warnOnce(routingKey, now, `unreadable message on ${routingKey}: not JSON`);
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = readPayload(envelope.event, this.messageKey);
    } catch (err) {
      this.warnOnce(envelope.source ?? routingKey, now, `could not read the ${envelope.event?.type ?? routingKey} payload from ${envelope.source}: ${err instanceof Error ? err.message : err}`);
      return;
    }
    this.lastError.delete(envelope.source ?? routingKey);

    if (envelope.event?.type === 'heartbeat.node' && typeof payload.nodeId === 'string') {
      const resources = (payload.resources ?? undefined) as NodeResources | undefined;
      const agentUrl = typeof payload.agentUrl === 'string' ? payload.agentUrl : undefined;
      let host: string | undefined;
      try {
        host = agentUrl ? new URL(agentUrl).hostname : undefined;
      } catch {
        host = undefined;
      }
      recordSource(
        this.store,
        {
          name: payload.nodeId,
          kind: 'node',
          status: 'up',
          lastSeen: now,
          uptimePct: null,
          origin: 'bus',
          detail: { ...(resources ? { resources } : {}), ...(host ? { host } : {}), ...(payload.connection === 'outbound' ? { connection: 'outbound' } : {}) },
        },
        now,
      );
      if (resources) this.sampleResources(payload.nodeId, resources, now);
      return;
    }
    if (envelope.event?.type === 'heartbeat.service') {
      const name = typeof payload.name === 'string' ? payload.name : envelope.source;
      recordSource(this.store, { name, kind: 'service', status: 'up', lastSeen: now, uptimePct: null, origin: 'bus', detail: {} }, now);
      return;
    }
    this.business?.record(routingKey, envelope, payload, now);
  }

  /** CPU / memory / disk in %, per node. A value the agent did not measure is not stored. */
  private sampleResources(node: string, r: NodeResources, now: number): void {
    if (finite(r.cpuPercent)) this.store.addSample('cpu', node, now, r.cpuPercent);
    if (finite(r.ramUsedMb) && finite(r.ramTotalMb) && r.ramTotalMb > 0) this.store.addSample('memory', node, now, (r.ramUsedMb / r.ramTotalMb) * 100);
    if (finite(r.diskUsedGb) && finite(r.diskTotalGb) && r.diskTotalGb > 0) this.store.addSample('disk', node, now, (r.diskUsedGb / r.diskTotalGb) * 100);
  }

  private warnOnce(source: string, now: number, message: string): void {
    if (this.lastError.get(source) === message) return;
    this.lastError.set(source, message);
    this.store.addLog({ ts: now, level: 'warn', service: 'collector', project: 'nexusinfra', node: 'collector', message, fields: { source, exchange: EXCHANGE } });
  }

  /** Binds the collector's own queue and starts consuming. */
  async attach(channel: BusChannel, queue: string): Promise<void> {
    await channel.checkExchange(EXCHANGE);
    const { queue: name } = await channel.assertQueue(queue, { exclusive: true, autoDelete: true, durable: false });
    for (const pattern of this.bindings()) await channel.bindQueue(name, EXCHANGE, pattern);
    await channel.consume(name, (msg) => msg && this.handle(msg.fields.routingKey, msg.content), { noAck: true });
  }
}

/**
 * Connects with amqplib and keeps reconnecting with backoff (the exchange may not exist until
 * NexusInfra or FinVault has started). `report` feeds the collector's `/health`.
 */
export async function startBus(url: string, queue: string, consumer: HeartbeatConsumer, report: (error: string | null) => void): Promise<() => Promise<void>> {
  const amqp = await import('amqplib');
  let stopped = false;
  let connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
  let delay = 1000;

  const connect = async (): Promise<void> => {
    if (stopped) return;
    try {
      connection = await amqp.connect(url);
      connection.on('error', () => {
        // An unhandled 'error' would crash the process; 'close' follows and reconnects.
      });
      const channel = await connection.createChannel();
      channel.on('error', () => undefined);
      await consumer.attach(channel as unknown as BusChannel, queue);
      // Only a working connection reconnects on close; a failed attempt retries below.
      connection.on('close', () => {
        connection = null;
        if (!stopped) {
          report('connection closed');
          setTimeout(() => void connect(), delay);
        }
      });
      delay = 1000;
      report(null);
    } catch (err) {
      report(err instanceof Error ? err.message : String(err));
      try {
        await connection?.close();
      } catch {
        // already closed
      }
      connection = null;
      delay = Math.min(delay * 2, 60_000);
      if (!stopped) setTimeout(() => void connect(), delay);
    }
  };
  await connect();
  return async () => {
    stopped = true;
    await connection?.close().catch(() => undefined);
  };
}
