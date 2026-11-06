/**
 * Reading event payloads from the shared `finvault.events` exchange.
 *
 * A mirror of NexusInfra's `shared/src/events.ts` `readPayload()` / `decryptPayload()`. The
 * algorithm, KDF salt, key length and ciphertext layout below MUST stay identical to NexusInfra's
 * and FinVault's, or encrypted payloads become unreadable. `payload.test.ts` decrypts a ciphertext
 * produced by NexusInfra itself to keep this honest. Never change these constants here alone.
 *
 * NexusWatch only reads: there is deliberately no encrypt / build-envelope counterpart.
 */
import { createDecipheriv, scryptSync } from 'node:crypto';

export const ALGORITHM = 'aes-256-gcm';
export const KDF_SALT = 'finvault-events-v1';
export const KEY_BYTES = 32;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;

/** The envelope every service publishes (NexusInfra `EventEnvelope`). */
export interface EventEnvelope {
  eventId: string;
  timestamp: string;
  source: string;
  event: { type: string; payload: unknown };
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, KDF_SALT, KEY_BYTES);
}

/** Layout: iv(12) | tag(16) | ciphertext, base64. */
export function decryptPayload(ciphertext: string, secret: string): Record<string, unknown> {
  const key = deriveKey(secret);
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

/**
 * The plain payload of an event, decrypting it when it arrived as `{ encrypted: true, data }`.
 * Reads `FINVAULT_MESSAGE_KEY` like NexusInfra does; `messageKey` is injectable for tests.
 */
export function readPayload(event: EventEnvelope['event'], messageKey: string | undefined = process.env.FINVAULT_MESSAGE_KEY): Record<string, unknown> {
  const payload = event.payload as Record<string, unknown>;
  if (payload && payload.encrypted === true && typeof payload.data === 'string') {
    if (!messageKey) {
      throw new Error('Encrypted event payload received but FINVAULT_MESSAGE_KEY is not set');
    }
    try {
      return decryptPayload(payload.data, messageKey);
    } catch {
      throw new Error(
        "Could not decrypt an event payload: FINVAULT_MESSAGE_KEY differs from the sender's, or the payload was altered. " +
          'Both platforms must use the same key.',
      );
    }
  }
  return payload;
}
