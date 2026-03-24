/**
 * Key Derivation Module
 *
 * Derives a 256-bit AES encryption key from a TON Connect wallet signature
 * using HKDF (HMAC-based Key Derivation Function) as defined in RFC 5869.
 *
 * Flow:
 * 1. User signs a deterministic challenge message via TON Connect
 * 2. The raw signature bytes become the Input Key Material (IKM)
 * 3. HKDF-SHA256 extracts and expands into a 256-bit AES key
 *
 * This ensures the encryption key is:
 * - Deterministic (same wallet + same challenge = same key)
 * - Never stored on any server
 * - Only reproducible by the wallet owner
 */

import { createHmac, randomBytes } from 'node:crypto';
import type { DerivedKeyMaterial } from '../types/profile.js';

/** Fixed context string for HKDF info parameter — binds key to TradeMind domain */
const HKDF_INFO = Buffer.from('TradeMind-IdentityHub-ProfileEncryption-v1', 'utf-8');

/** Output key length in bytes (256 bits for AES-256) */
const KEY_LENGTH_BYTES = 32;

/** Salt length in bytes */
const SALT_LENGTH_BYTES = 32;

/**
 * The deterministic challenge message that the user signs via TON Connect.
 * This message MUST be identical every time to produce the same derived key.
 * It is shown to the user in the wallet UI before signing.
 */
export const SIGNING_CHALLENGE =
  'TradeMind: Authorize profile encryption.\n' +
  'This signature will be used to derive your personal encryption key.\n' +
  'It does NOT authorize any transaction.';

/**
 * HKDF-Extract: PRK = HMAC-SHA256(salt, ikm)
 *
 * Extracts a pseudorandom key from the input key material.
 */
function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac('sha256', salt).update(ikm).digest();
}

/**
 * HKDF-Expand: OKM = T(1) || T(2) || ... truncated to length
 *
 * Expands the pseudorandom key into the desired output length.
 */
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  const hashLength = 32; // SHA-256 output
  const blocksNeeded = Math.ceil(length / hashLength);

  if (blocksNeeded > 255) {
    throw new Error('HKDF-Expand: requested length too large');
  }

  const okm = Buffer.alloc(blocksNeeded * hashLength);
  let previousBlock = Buffer.alloc(0);

  for (let i = 1; i <= blocksNeeded; i++) {
    const hmac = createHmac('sha256', prk);
    hmac.update(previousBlock);
    hmac.update(info);
    hmac.update(Buffer.from([i]));
    previousBlock = hmac.digest();
    previousBlock.copy(okm, (i - 1) * hashLength);
  }

  return okm.subarray(0, length);
}

/**
 * Derives a 256-bit AES key from a TON Connect wallet signature.
 *
 * @param walletSignature - Raw signature bytes from TON Connect `signData`
 * @param existingSalt    - If re-deriving, pass the same salt. Otherwise a new one is generated.
 * @returns DerivedKeyMaterial with the AES key and salt
 *
 * @throws Error if signature is empty or has insufficient entropy
 *
 * @example
 * ```ts
 * // First time — generate new salt
 * const keyMaterial = deriveEncryptionKey(signatureBytes);
 *
 * // Re-derive with stored salt
 * const keyMaterial = deriveEncryptionKey(signatureBytes, storedSalt);
 * ```
 */
export function deriveEncryptionKey(
  walletSignature: Buffer,
  existingSalt?: string,
): DerivedKeyMaterial {
  if (walletSignature.length < 32) {
    throw new Error(
      `Wallet signature too short: ${walletSignature.length} bytes. ` +
      'Expected at least 32 bytes of entropy from TON Connect signature.',
    );
  }

  const salt = existingSalt
    ? Buffer.from(existingSalt, 'hex')
    : randomBytes(SALT_LENGTH_BYTES);

  // HKDF-Extract: condense the signature into a fixed-length PRK
  const prk = hkdfExtract(salt, walletSignature);

  // HKDF-Expand: derive the final AES-256 key with domain-specific context
  const key = hkdfExpand(prk, HKDF_INFO, KEY_LENGTH_BYTES);

  return {
    key,
    salt: salt.toString('hex'),
  };
}

/**
 * Validates that a wallet signature has sufficient entropy for key derivation.
 * Useful for pre-checking before attempting encryption.
 */
export function validateSignatureEntropy(signature: Buffer): {
  readonly valid: boolean;
  readonly reason: string | null;
} {
  if (signature.length < 32) {
    return {
      valid: false,
      reason: `Signature too short: ${signature.length} bytes, need at least 32`,
    };
  }

  // Check for degenerate signatures (all zeros, all ones)
  const allSame = signature.every((byte) => byte === signature[0]);
  if (allSame) {
    return {
      valid: false,
      reason: 'Signature has zero entropy (all bytes identical)',
    };
  }

  return { valid: true, reason: null };
}
