import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALGORITHM, IV_BYTES, KDF_SALT, KEY_BYTES, TAG_BYTES, decryptPayload, readPayload } from './payload.js';

const KEY = 'nexuswatch-wire-test-key';

/**
 * Produced by NexusInfra's own `encryptPayload()` (shared/src/events.ts) with KEY. If this stops
 * decrypting, NexusWatch can no longer read the bus — fix the mirror, never the fixture.
 */
const FROM_NEXUSINFRA =
  '2gpdbmlUTy9vvNI/jZ9LdbLqTbcaoNuOcmehul7jq3jHW/FMXdvA9yl72zAynoFrf98qk1SAq+4jbsFGNCWfxYyL1herVD2HRcXbbWipKaINFi+Y6afM9kwkMMSgyzH+EDM3q4BlsSgYyawV7g==';

describe('wire compatibility with NexusInfra / FinVault', () => {
  it('uses the shared constants', () => {
    expect(ALGORITHM).toBe('aes-256-gcm');
    expect(KDF_SALT).toBe('finvault-events-v1');
    expect([KEY_BYTES, IV_BYTES, TAG_BYTES]).toEqual([32, 12, 16]);
  });

  it('decrypts a payload encrypted by NexusInfra', () => {
    expect(decryptPayload(FROM_NEXUSINFRA, KEY)).toEqual({ name: 'control-room', status: 'healthy', timestamp: '2026-11-05T10:00:00.000Z' });
  });

  it('decrypts the iv | tag | ciphertext layout built from the constants', () => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, scryptSync(KEY, KDF_SALT, KEY_BYTES), iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify({ nodeId: 'node-pi' })), cipher.final()]);
    const data = Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
    expect(decryptPayload(data, KEY)).toEqual({ nodeId: 'node-pi' });
  });
});

describe('readPayload', () => {
  const encrypted = { type: 'heartbeat.service', payload: { encrypted: true, data: FROM_NEXUSINFRA } };

  it('passes a plain payload through', () => {
    expect(readPayload({ type: 'heartbeat.node', payload: { nodeId: 'n1' } }, undefined)).toEqual({ nodeId: 'n1' });
  });

  it('decrypts with the shared key', () => {
    expect(readPayload(encrypted, KEY)).toMatchObject({ name: 'control-room' });
  });

  it('explains a missing or different key', () => {
    expect(() => readPayload(encrypted, undefined)).toThrow(/FINVAULT_MESSAGE_KEY is not set/);
    expect(() => readPayload(encrypted, 'another-key')).toThrow(/differs from the sender's/);
  });
});
