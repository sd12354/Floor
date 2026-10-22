import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { NotConfiguredError } from '@floor/core';

const VERSION = 'v1';

/** Parse FLOOR_SECRET_KEY: exactly 32 bytes as 64 hex chars or base64. Anything else is refused (no silent weak keys). */
export function parseSecretKey(raw: string | undefined): Buffer {
  if (!raw) throw new NotConfiguredError('Floor', ['FLOOR_SECRET_KEY (32 random bytes: openssl rand -base64 32)']);
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new NotConfiguredError('Floor', ['FLOOR_SECRET_KEY must decode to exactly 32 bytes (openssl rand -base64 32)']);
  return key;
}

/** AES-256-GCM. Output `v1:<base64(iv12 | tag16 | ciphertext)>`; a fresh random IV per call. */
export function encryptSecret(plaintext: string, rawKey: string | undefined): string {
  const key = parseSecretKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
}

/** Throws if the key is wrong or the blob was tampered with (GCM authentication). */
export function decryptSecret(blob: string, rawKey: string | undefined): string {
  const key = parseSecretKey(rawKey);
  const [version, b64] = blob.split(':');
  if (version !== VERSION || !b64) throw new Error('unrecognised secret format');
  const raw = Buffer.from(b64, 'base64');
  if (raw.length < 29) throw new Error('secret blob too short');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
