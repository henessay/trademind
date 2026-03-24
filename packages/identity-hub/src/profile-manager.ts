/**
 * ProfileManager — Orchestrator for Identity Hub
 *
 * The central coordinator that manages the complete lifecycle of a user's
 * semantic profile in TradeMind:
 *
 * ┌─────────────┐     ┌────────────┐     ┌──────────────┐     ┌───────────────┐
 * │ User message │────>│ LLM Parser │────>│ ProfileCipher│────>│  TON Storage  │
 * │ (natural     │     │ (extract   │     │ (AES-256-GCM │     │  (upload Bag, │
 * │  language)   │     │  RiskProfile│    │  encrypt)    │     │   deploy      │
 * └─────────────┘     └────────────┘     └──────────────┘     │   contract)   │
 *                                                              └───────────────┘
 *
 * Loading a profile reverses the flow:
 *
 * ┌───────────────┐     ┌──────────────┐     ┌─────────────┐
 * │  TON Storage  │────>│ ProfileCipher│────>│ UserProfile  │
 * │  (download    │     │ (AES-256-GCM │     │ (injected    │
 * │   by Bag ID)  │     │  decrypt)    │     │  into chat   │
 * └───────────────┘     └──────────────┘     │  session)    │
 *                                             └─────────────┘
 *
 * Design principles:
 * - Dependency Injection for all external services (LLM, Storage)
 * - Zero knowledge of private keys (signing happens client-side)
 * - All types are strict (no `any`, see CLAUDE.md §5)
 * - Telegram ID is NEVER passed to storage or external APIs (CLAUDE.md §10)
 */

import {
  deriveEncryptionKey,
  validateSignatureEntropy,
} from './crypto/key-derivation.js';
import {
  encryptProfile,
  decryptProfile,
} from './crypto/profile-cipher.js';
import { TonStorageClient, TonStorageError } from './storage/ton-storage-client.js';
import {
  buildStorageContractDeployment,
  calculateStorageCost,
  type StorageContractTransaction,
} from './storage/storage-contract.js';
import type {
  EncryptedPayload,
  IntentParserAdapter,
  ProfileManagerDeps,
  ProfileOperationResult,
  RiskProfile,
  StorageBagMetadata,
  StorageContractConfig,
  TonStorageClientConfig,
  UserProfile,
} from './types/profile.js';
import type { TonStorageTransport } from './storage/ton-storage-client.js';

/** Current profile schema version */
const PROFILE_SCHEMA_VERSION = 1;

/** Default storage guarantee: 1 year */
const DEFAULT_GUARANTEE_PERIOD_SEC = 365 * 24 * 60 * 60;

// ─── Error Types ─────────────────────────────────────────────

export class ProfileManagerError extends Error {
  readonly code: ProfileErrorCode;

  constructor(message: string, code: ProfileErrorCode) {
    super(message);
    this.name = 'ProfileManagerError';
    this.code = code;
  }
}

export type ProfileErrorCode =
  | 'INVALID_SIGNATURE'
  | 'PARSE_FAILED'
  | 'ENCRYPTION_FAILED'
  | 'STORAGE_UPLOAD_FAILED'
  | 'STORAGE_DOWNLOAD_FAILED'
  | 'PROFILE_NOT_FOUND'
  | 'DECRYPTION_FAILED'
  | 'CONTRACT_BUILD_FAILED';

// ─── ProfileManager ──────────────────────────────────────────

export class ProfileManager {
  private readonly intentParser: IntentParserAdapter;
  private readonly storageClient: TonStorageClient;
  private readonly storageConfig: TonStorageClientConfig;

  constructor(
    deps: ProfileManagerDeps,
    transport: TonStorageTransport,
  ) {
    this.intentParser = deps.intentParser;
    this.storageConfig = deps.storageConfig;
    this.storageClient = new TonStorageClient(transport, deps.storageConfig);
  }

  /**
   * Creates a new user profile from a natural language message.
   *
   * Full flow:
   * 1. Parse user intent via LLM → RiskProfile
   * 2. Build UserProfile object
   * 3. Derive encryption key from wallet signature
   * 4. Encrypt profile with AES-256-GCM
   * 5. Upload encrypted payload to TON Storage
   * 6. Return profile + storage metadata
   *
   * @param userMessage      - Natural language input (e.g., "Хочу вложить надежно на год")
   * @param walletAddress    - User's TON wallet address
   * @param walletSignature  - Raw signature of SIGNING_CHALLENGE from TON Connect
   * @returns ProfileOperationResult with profile, storage metadata, and contract tx
   *
   * @throws ProfileManagerError with specific error codes
   */
  async createProfile(
    userMessage: string,
    walletAddress: string,
    walletSignature: Buffer,
  ): Promise<ProfileOperationResult> {
    // ── Step 1: Validate signature ──
    const entropyCheck = validateSignatureEntropy(walletSignature);
    if (!entropyCheck.valid) {
      throw new ProfileManagerError(
        `Invalid wallet signature: ${entropyCheck.reason}`,
        'INVALID_SIGNATURE',
      );
    }

    // ── Step 2: Parse user intent via LLM ──
    let riskProfile: RiskProfile;
    try {
      const parsedIntent = await this.intentParser.parseUserIntent(userMessage);
      riskProfile = parsedIntent.riskProfile;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown parsing error';
      throw new ProfileManagerError(
        `Failed to parse user intent: ${message}`,
        'PARSE_FAILED',
      );
    }

    // ── Step 3: Build UserProfile (without bagId yet) ──
    const profile: UserProfile = {
      walletAddress,
      riskProfile,
      bagId: null,
      storageContractAddress: null,
      updatedAt: new Date().toISOString(),
      schemaVersion: PROFILE_SCHEMA_VERSION,
    };

    // ── Step 4: Encrypt ──
    const { encryptedPayload, salt } = this.encryptUserProfile(
      profile,
      walletSignature,
    );

    // ── Step 5: Upload to TON Storage ──
    let storageMeta: StorageBagMetadata;
    try {
      storageMeta = await this.storageClient.uploadBag(encryptedPayload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      throw new ProfileManagerError(
        `TON Storage upload failed: ${message}`,
        'STORAGE_UPLOAD_FAILED',
      );
    }

    // ── Step 6: Update profile with Bag ID ──
    const finalProfile: UserProfile = {
      ...profile,
      bagId: storageMeta.bagId,
    };

    return {
      profile: finalProfile,
      storageMeta,
      storageContract: null, // Contract is deployed separately via buildDeployTransaction
    };
  }

  /**
   * Loads and decrypts an existing profile from TON Storage.
   * This is the "Universal Resolver" — called on every new chat session
   * to restore the user's financial context.
   *
   * @param bagId           - TON Storage Bag ID
   * @param walletSignature - Re-derived signature from TON Connect
   * @param salt            - The salt used during original encryption (stored alongside Bag ID)
   * @param expectedHash    - Optional SHA-256 hash for integrity verification
   * @returns The decrypted UserProfile, ready to inject into the chat session
   */
  async loadProfile(
    bagId: string,
    walletSignature: Buffer,
    salt: string,
    expectedHash?: string,
  ): Promise<UserProfile> {
    // ── Download encrypted payload ──
    let encryptedPayload: EncryptedPayload;
    try {
      encryptedPayload = await this.storageClient.downloadBag(
        bagId,
        expectedHash,
      );
    } catch (error: unknown) {
      if (error instanceof TonStorageError && error.code === 'BAG_NOT_FOUND') {
        throw new ProfileManagerError(
          `Profile not found in TON Storage: bag ${bagId}`,
          'PROFILE_NOT_FOUND',
        );
      }
      const message = error instanceof Error ? error.message : 'Download failed';
      throw new ProfileManagerError(
        `Failed to download profile: ${message}`,
        'STORAGE_DOWNLOAD_FAILED',
      );
    }

    // ── Re-derive key using same salt ──
    const keyMaterial = deriveEncryptionKey(walletSignature, salt);

    // ── Decrypt ──
    try {
      return decryptProfile(encryptedPayload, keyMaterial.key);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Decryption failed';
      throw new ProfileManagerError(
        `Failed to decrypt profile: ${message}`,
        'DECRYPTION_FAILED',
      );
    }
  }

  /**
   * Updates an existing profile with new preferences.
   * Re-encrypts and re-uploads to TON Storage with a new Bag ID.
   *
   * @param existingProfile  - Current profile (loaded via loadProfile)
   * @param updatedRiskProfile - New risk profile from user conversation
   * @param walletSignature  - Fresh signature from TON Connect
   * @returns Updated ProfileOperationResult with new Bag ID
   */
  async updateProfile(
    existingProfile: UserProfile,
    updatedRiskProfile: RiskProfile,
    walletSignature: Buffer,
  ): Promise<ProfileOperationResult> {
    const entropyCheck = validateSignatureEntropy(walletSignature);
    if (!entropyCheck.valid) {
      throw new ProfileManagerError(
        `Invalid wallet signature: ${entropyCheck.reason}`,
        'INVALID_SIGNATURE',
      );
    }

    const updatedProfile: UserProfile = {
      ...existingProfile,
      riskProfile: updatedRiskProfile,
      updatedAt: new Date().toISOString(),
    };

    // Encrypt with fresh key derivation
    const { encryptedPayload } = this.encryptUserProfile(
      updatedProfile,
      walletSignature,
    );

    // Upload new version
    let storageMeta: StorageBagMetadata;
    try {
      storageMeta = await this.storageClient.uploadBag(encryptedPayload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      throw new ProfileManagerError(
        `TON Storage upload failed: ${message}`,
        'STORAGE_UPLOAD_FAILED',
      );
    }

    const finalProfile: UserProfile = {
      ...updatedProfile,
      bagId: storageMeta.bagId,
    };

    return {
      profile: finalProfile,
      storageMeta,
      storageContract: null,
    };
  }

  /**
   * Builds a storage guarantee contract deployment transaction.
   *
   * This creates a pre-signed BOC that the user approves via TON Connect.
   * The contract ensures TON Storage providers keep the data available
   * for the specified duration by locking Toncoin as payment.
   *
   * @param bagId             - Bag ID of the uploaded profile
   * @param payloadSizeBytes  - Size of the encrypted payload
   * @param ownerAddress      - User's wallet address (contract owner)
   * @param providerAddress   - Storage provider's address
   * @param guaranteePeriodSec - Duration in seconds (default: 1 year)
   * @returns Pre-built transaction for TON Connect signing
   */
  buildDeployTransaction(
    bagId: string,
    payloadSizeBytes: number,
    ownerAddress: string,
    providerAddress: string,
    guaranteePeriodSec: number = DEFAULT_GUARANTEE_PERIOD_SEC,
  ): StorageContractTransaction {
    try {
      return buildStorageContractDeployment({
        bagId,
        payloadSizeBytes,
        guaranteePeriodSec,
        ownerAddress,
        providerAddress,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Build failed';
      throw new ProfileManagerError(
        `Failed to build storage contract: ${message}`,
        'CONTRACT_BUILD_FAILED',
      );
    }
  }

  /**
   * Estimates the Toncoin cost for storing a profile.
   * Useful for showing the user an estimate before they approve.
   */
  estimateStorageCost(
    payloadSizeBytes: number,
    guaranteePeriodSec: number = DEFAULT_GUARANTEE_PERIOD_SEC,
  ): { readonly nanotons: bigint; readonly toncoins: string } {
    const nanotons = calculateStorageCost(payloadSizeBytes, guaranteePeriodSec);
    const toncoins = formatNanotons(nanotons);
    return { nanotons, toncoins };
  }

  // ─── Private Helpers ─────────────────────────────────────────

  private encryptUserProfile(
    profile: UserProfile,
    walletSignature: Buffer,
  ): { encryptedPayload: EncryptedPayload; salt: string } {
    try {
      const keyMaterial = deriveEncryptionKey(walletSignature);
      const encryptedPayload = encryptProfile(profile, keyMaterial.key);
      return {
        encryptedPayload,
        salt: keyMaterial.salt,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Encryption failed';
      throw new ProfileManagerError(
        `Profile encryption failed: ${message}`,
        'ENCRYPTION_FAILED',
      );
    }
  }
}

// ─── Utility ─────────────────────────────────────────────────

function formatNanotons(nanotons: bigint): string {
  const whole = nanotons / 1_000_000_000n;
  const fractional = nanotons % 1_000_000_000n;
  const fractionalStr = fractional.toString().padStart(9, '0').replace(/0+$/, '');
  return fractionalStr.length > 0
    ? `${whole}.${fractionalStr}`
    : whole.toString();
}
