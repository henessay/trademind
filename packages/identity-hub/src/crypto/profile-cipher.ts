/**
 * Profile Cipher Module
 *
 * Symmetric encryption and decryption of UserProfile using AES-256-GCM.
 *
 * Security properties:
 * - AES-256-GCM provides authenticated encryption (confidentiality + integrity)
 * - 96-bit random IV per encryption (NIST recommended for GCM)
 * - 128-bit authentication tag prevents tampering
 * - Key is never stored — derived on-the-fly from TON Connect signature
 *
 * The encrypted payload is self-describing: it contains the algorithm
 * identifier and schema version for future-proof decryption.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import type { EncryptedPayload, UserProfile } from '../types/profile.js';

/** Current schema version — increment when UserProfile shape changes */
const CURRENT_SCHEMA_VERSION = 1;

/** GCM standard IV length in bytes (96 bits as per NIST SP 800-38D) */
const IV_LENGTH_BYTES = 12;

/** GCM authentication tag length in bytes */
const AUTH_TAG_LENGTH_BYTES = 16;

/** AES-256-GCM algorithm string for Node.js crypto */
const ALGORITHM = 'aes-256-gcm' as const;

/**
 * Encrypts a UserProfile into an EncryptedPayload using AES-256-GCM.
 *
 * @param profile - The user profile to encrypt
 * @param key     - 256-bit AES key (from key-derivation module)
 * @returns EncryptedPayload with ciphertext, IV, auth tag (all base64)
 *
 * @throws Error if key length is not exactly 32 bytes
 *
 * @example
 * ```ts
 * const encrypted = encryptProfile(userProfile, keyMaterial.key);
 * // => { ciphertext: "...", iv: "...", authTag: "...", algorithm: "aes-256-gcm", schemaVersion: 1 }
 * ```
 */
export function encryptProfile(
  profile: UserProfile,
  key: Buffer,
): EncryptedPayload {
  validateKeyLength(key);

  const iv = randomBytes(IV_LENGTH_BYTES);
  const plaintext = Buffer.from(JSON.stringify(profile), 'utf-8');

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    algorithm: ALGORITHM,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * Decrypts an EncryptedPayload back into a UserProfile.
 *
 * @param payload - The encrypted payload (from TON Storage)
 * @param key     - 256-bit AES key (re-derived from wallet signature)
 * @returns The decrypted and parsed UserProfile
 *
 * @throws Error if decryption fails (wrong key, tampered data, or corrupted payload)
 * @throws Error if decrypted data is not valid JSON
 * @throws Error if schema version is unsupported
 *
 * @example
 * ```ts
 * const profile = decryptProfile(encryptedPayload, keyMaterial.key);
 * // => { walletAddress: "...", riskProfile: {...}, ... }
 * ```
 */
export function decryptProfile(
  payload: EncryptedPayload,
  key: Buffer,
): UserProfile {
  validateKeyLength(key);

  if (payload.algorithm !== ALGORITHM) {
    throw new Error(
      `Unsupported encryption algorithm: "${payload.algorithm}". ` +
      `Expected "${ALGORITHM}".`,
    );
  }

  if (payload.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schema version: ${payload.schemaVersion}. ` +
      `This client supports up to version ${CURRENT_SCHEMA_VERSION}. ` +
      'Please update the identity-hub package.',
    );
  }

  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(authTag);

  let decrypted: Buffer;
  try {
    decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Profile decryption failed: ${message}. ` +
      'This usually means the wrong wallet signed the challenge, ' +
      'or the encrypted data has been tampered with.',
    );
  }

  const parsed: unknown = JSON.parse(decrypted.toString('utf-8'));

  if (!isValidUserProfile(parsed)) {
    throw new Error(
      'Decrypted data does not match UserProfile schema. ' +
      'The profile may be corrupted or from an incompatible version.',
    );
  }

  return parsed;
}

/**
 * Serializes an EncryptedPayload into a binary buffer for TON Storage upload.
 *
 * Format: [4 bytes schemaVersion LE][payload JSON bytes]
 * The leading 4 bytes allow future readers to identify the format
 * without parsing JSON first.
 */
export function serializePayload(payload: EncryptedPayload): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.schemaVersion, 0);
  return Buffer.concat([header, jsonBytes]);
}

/**
 * Deserializes a binary buffer (from TON Storage) back into an EncryptedPayload.
 */
export function deserializePayload(data: Buffer): EncryptedPayload {
  if (data.length < 5) {
    throw new Error(`Payload too small: ${data.length} bytes`);
  }

  const schemaVersion = data.readUInt32LE(0);

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported payload schema version: ${schemaVersion}. ` +
      `Max supported: ${CURRENT_SCHEMA_VERSION}.`,
    );
  }

  const jsonBytes = data.subarray(4);
  const parsed: unknown = JSON.parse(jsonBytes.toString('utf-8'));

  if (!isValidEncryptedPayload(parsed)) {
    throw new Error('Deserialized data does not match EncryptedPayload schema');
  }

  return parsed;
}

// ─── Validation Helpers ──────────────────────────────────────

function validateKeyLength(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error(
      `Invalid AES-256 key length: ${key.length} bytes. Expected exactly 32 bytes.`,
    );
  }
}

function isValidUserProfile(value: unknown): value is UserProfile {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['walletAddress'] === 'string' &&
    typeof obj['riskProfile'] === 'object' &&
    obj['riskProfile'] !== null &&
    typeof obj['updatedAt'] === 'string' &&
    typeof obj['schemaVersion'] === 'number'
  );
}

function isValidEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['ciphertext'] === 'string' &&
    typeof obj['iv'] === 'string' &&
    typeof obj['authTag'] === 'string' &&
    obj['algorithm'] === ALGORITHM &&
    typeof obj['schemaVersion'] === 'number'
  );
}
