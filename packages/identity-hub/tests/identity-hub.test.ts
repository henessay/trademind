/**
 * Tests for Identity Hub: Crypto + Intent Parser
 *
 * Validates:
 * - Key derivation determinism (same input → same key)
 * - Encrypt → decrypt round-trip integrity
 * - Tamper detection (modified ciphertext → error)
 * - Wrong key detection (different signature → decryption fails)
 * - Signature entropy validation
 * - Intent parser validation logic
 * - Payload serialization/deserialization
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  deriveEncryptionKey,
  validateSignatureEntropy,
} from '../src/crypto/key-derivation.js';
import {
  encryptProfile,
  decryptProfile,
  serializePayload,
  deserializePayload,
} from '../src/crypto/profile-cipher.js';
import {
  validateLlmResponse,
  needsClarification,
  buildClarificationPrompt,
} from '../src/parsers/intent-parser.js';
import type { UserProfile, EncryptedPayload } from '../src/types/profile.js';

// ─── Test Fixtures ───────────────────────────────────────────

const mockSignature = randomBytes(64); // Simulates a TON Connect ed25519 signature
const mockSignature2 = randomBytes(64); // Different signature

const testProfile: UserProfile = {
  walletAddress: 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2',
  riskProfile: {
    riskLevel: 'conservative',
    timeHorizon: 'long',
    preferredAssets: ['TON', 'USDT'],
    maxDrawdown: 0.1,
  },
  bagId: null,
  storageContractAddress: null,
  updatedAt: '2026-03-22T00:00:00.000Z',
  schemaVersion: 1,
};

// ─── Key Derivation Tests ────────────────────────────────────

describe('Key Derivation', () => {
  it('should derive a 256-bit key from wallet signature', () => {
    const result = deriveEncryptionKey(mockSignature);

    expect(result.key).toBeInstanceOf(Buffer);
    expect(result.key.length).toBe(32); // 256 bits
    expect(result.salt).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex
  });

  it('should produce deterministic output with same signature + salt', () => {
    const result1 = deriveEncryptionKey(mockSignature);
    const result2 = deriveEncryptionKey(mockSignature, result1.salt);

    expect(result2.key.equals(result1.key)).toBe(true);
    expect(result2.salt).toBe(result1.salt);
  });

  it('should produce different keys with different salts', () => {
    const result1 = deriveEncryptionKey(mockSignature);
    const result2 = deriveEncryptionKey(mockSignature); // new random salt

    // Extremely unlikely to collide
    expect(result2.key.equals(result1.key)).toBe(false);
  });

  it('should produce different keys from different signatures', () => {
    const salt = deriveEncryptionKey(mockSignature).salt;
    const result1 = deriveEncryptionKey(mockSignature, salt);
    const result2 = deriveEncryptionKey(mockSignature2, salt);

    expect(result2.key.equals(result1.key)).toBe(false);
  });

  it('should reject short signatures', () => {
    const shortSig = randomBytes(16);
    expect(() => deriveEncryptionKey(shortSig)).toThrow('too short');
  });

  it('should validate signature entropy', () => {
    const good = validateSignatureEntropy(mockSignature);
    expect(good.valid).toBe(true);
    expect(good.reason).toBeNull();

    const bad = validateSignatureEntropy(Buffer.alloc(64, 0x00));
    expect(bad.valid).toBe(false);
    expect(bad.reason).toContain('zero entropy');

    const tooShort = validateSignatureEntropy(Buffer.alloc(8));
    expect(tooShort.valid).toBe(false);
    expect(tooShort.reason).toContain('too short');
  });
});

// ─── Profile Cipher Tests ────────────────────────────────────

describe('Profile Cipher', () => {
  it('should encrypt and decrypt a profile losslessly', () => {
    const keyMaterial = deriveEncryptionKey(mockSignature);
    const encrypted = encryptProfile(testProfile, keyMaterial.key);

    expect(encrypted.algorithm).toBe('aes-256-gcm');
    expect(encrypted.schemaVersion).toBe(1);
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    expect(encrypted.iv.length).toBeGreaterThan(0);
    expect(encrypted.authTag.length).toBeGreaterThan(0);

    const decrypted = decryptProfile(encrypted, keyMaterial.key);

    expect(decrypted.walletAddress).toBe(testProfile.walletAddress);
    expect(decrypted.riskProfile.riskLevel).toBe('conservative');
    expect(decrypted.riskProfile.timeHorizon).toBe('long');
    expect(decrypted.riskProfile.maxDrawdown).toBe(0.1);
    expect(decrypted.schemaVersion).toBe(1);
  });

  it('should fail decryption with wrong key', () => {
    const key1 = deriveEncryptionKey(mockSignature);
    const key2 = deriveEncryptionKey(mockSignature2);
    const encrypted = encryptProfile(testProfile, key1.key);

    expect(() => decryptProfile(encrypted, key2.key)).toThrow('decryption failed');
  });

  it('should detect tampered ciphertext', () => {
    const keyMaterial = deriveEncryptionKey(mockSignature);
    const encrypted = encryptProfile(testProfile, keyMaterial.key);

    // Tamper with ciphertext
    const tamperedCt = Buffer.from(encrypted.ciphertext, 'base64');
    tamperedCt[0] ^= 0xff;
    const tampered: EncryptedPayload = {
      ...encrypted,
      ciphertext: tamperedCt.toString('base64'),
    };

    expect(() => decryptProfile(tampered, keyMaterial.key)).toThrow();
  });

  it('should reject invalid key length', () => {
    const shortKey = randomBytes(16);
    expect(() => encryptProfile(testProfile, shortKey)).toThrow('key length');
  });

  it('should produce different ciphertexts for same input (random IV)', () => {
    const keyMaterial = deriveEncryptionKey(mockSignature);
    const e1 = encryptProfile(testProfile, keyMaterial.key);
    const e2 = encryptProfile(testProfile, keyMaterial.key);

    // Same plaintext + same key but different random IVs
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
    expect(e1.iv).not.toBe(e2.iv);
  });
});

// ─── Payload Serialization Tests ─────────────────────────────

describe('Payload Serialization', () => {
  it('should round-trip serialize/deserialize', () => {
    const keyMaterial = deriveEncryptionKey(mockSignature);
    const encrypted = encryptProfile(testProfile, keyMaterial.key);

    const binary = serializePayload(encrypted);
    expect(binary).toBeInstanceOf(Buffer);
    expect(binary.length).toBeGreaterThan(4);

    const deserialized = deserializePayload(binary);
    expect(deserialized.ciphertext).toBe(encrypted.ciphertext);
    expect(deserialized.iv).toBe(encrypted.iv);
    expect(deserialized.authTag).toBe(encrypted.authTag);
    expect(deserialized.algorithm).toBe('aes-256-gcm');
  });

  it('should reject payload that is too small', () => {
    expect(() => deserializePayload(Buffer.alloc(3))).toThrow('too small');
  });
});

// ─── Intent Parser Validation Tests ──────────────────────────

describe('Intent Parser Validation', () => {
  it('should validate a correct LLM response', () => {
    const rawJson = JSON.stringify({
      riskLevel: 'conservative',
      timeHorizon: 'long',
      preferredAssets: ['TON', 'USDT'],
      maxDrawdown: 0.1,
      confidence: 0.85,
    });

    const result = validateLlmResponse(rawJson, 'test input');

    expect(result.riskProfile.riskLevel).toBe('conservative');
    expect(result.riskProfile.timeHorizon).toBe('long');
    expect(result.riskProfile.preferredAssets).toEqual(['TON', 'USDT']);
    expect(result.riskProfile.maxDrawdown).toBe(0.1);
    expect(result.confidence).toBe(0.85);
    expect(result.rawInput).toBe('test input');
  });

  it('should reject invalid riskLevel', () => {
    const rawJson = JSON.stringify({
      riskLevel: 'yolo',
      timeHorizon: 'long',
      preferredAssets: [],
      maxDrawdown: 0.1,
      confidence: 0.8,
    });

    expect(() => validateLlmResponse(rawJson, 'test')).toThrow('Invalid riskLevel');
  });

  it('should reject out-of-range maxDrawdown', () => {
    const rawJson = JSON.stringify({
      riskLevel: 'moderate',
      timeHorizon: 'medium',
      preferredAssets: [],
      maxDrawdown: 1.5,
      confidence: 0.8,
    });

    expect(() => validateLlmResponse(rawJson, 'test')).toThrow('maxDrawdown');
  });

  it('should reject invalid JSON', () => {
    expect(() => validateLlmResponse('not json', 'test')).toThrow('invalid JSON');
  });

  it('should detect low-confidence intents needing clarification', () => {
    const lowConfidence = {
      riskProfile: {
        riskLevel: 'moderate' as const,
        timeHorizon: 'medium' as const,
        preferredAssets: [] as readonly string[],
        maxDrawdown: 0.15,
      },
      rawInput: 'test',
      confidence: 0.4,
    };

    expect(needsClarification(lowConfidence)).toBe(true);

    const highConfidence = { ...lowConfidence, confidence: 0.9 };
    expect(needsClarification(highConfidence)).toBe(false);
  });

  it('should build meaningful clarification prompts', () => {
    const vague = {
      riskProfile: {
        riskLevel: 'moderate' as const,
        timeHorizon: 'medium' as const,
        preferredAssets: [] as readonly string[],
        maxDrawdown: 0.15,
      },
      rawInput: 'test',
      confidence: 0.3,
    };

    const prompt = buildClarificationPrompt(vague);
    expect(prompt).toContain('токены');
    expect(prompt).toContain('риска');
  });
});
