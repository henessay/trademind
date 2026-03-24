/**
 * Core types for Identity Hub.
 *
 * All interfaces are strictly typed — usage of `any` is forbidden.
 * See CLAUDE.md §5.
 */

// ─── Risk Profile ────────────────────────────────────────────

export type RiskLevel = 'conservative' | 'moderate' | 'aggressive';

export type TimeHorizon = 'short' | 'medium' | 'long';

export interface RiskProfile {
  /** User's risk tolerance level */
  readonly riskLevel: RiskLevel;

  /** Investment time horizon */
  readonly timeHorizon: TimeHorizon;

  /** List of preferred asset symbols (e.g., ['TON', 'USDT', 'jUSDT']) */
  readonly preferredAssets: readonly string[];

  /** Maximum acceptable drawdown as a decimal (e.g., 0.15 = 15%) */
  readonly maxDrawdown: number;
}

// ─── User Profile ────────────────────────────────────────────

export interface UserProfile {
  /** Unique identifier derived from TON wallet address */
  readonly walletAddress: string;

  /** Risk profile parsed from natural language */
  readonly riskProfile: RiskProfile;

  /** TON Storage Bag ID for the encrypted profile */
  readonly bagId: string | null;

  /** Address of the storage guarantee smart contract (null if not deployed) */
  readonly storageContractAddress: string | null;

  /** ISO 8601 timestamp of last profile update */
  readonly updatedAt: string;

  /** Profile schema version for migration support */
  readonly schemaVersion: number;
}

// ─── Encryption ──────────────────────────────────────────────

export interface EncryptedPayload {
  /** Encrypted binary data (base64-encoded) */
  readonly ciphertext: string;

  /** Initialization vector (base64-encoded) */
  readonly iv: string;

  /** Authentication tag (base64-encoded) */
  readonly authTag: string;

  /** Encryption algorithm identifier */
  readonly algorithm: 'aes-256-gcm';

  /** Schema version of the encrypted content */
  readonly schemaVersion: number;
}

export interface DerivedKeyMaterial {
  /** 256-bit AES key derived via HKDF from wallet signature */
  readonly key: Buffer;

  /** Salt used during derivation (hex-encoded, stored alongside payload) */
  readonly salt: string;
}

// ─── Intent Parsing (LLM Interface) ─────────────────────────

export interface ParsedIntent {
  /** Extracted risk profile from natural language */
  readonly riskProfile: RiskProfile;

  /** Raw user message that was parsed */
  readonly rawInput: string;

  /** Confidence score 0..1 from the LLM */
  readonly confidence: number;
}

/**
 * Adapter interface for the LLM that parses user intents.
 * Injected into ProfileManager for testability (Dependency Injection).
 */
export interface IntentParserAdapter {
  parseUserIntent(userMessage: string): Promise<ParsedIntent>;
}

// ─── TON Storage ─────────────────────────────────────────────

export interface StorageBagMetadata {
  /** Unique identifier of the bag in TON Storage */
  readonly bagId: string;

  /** Size of the encrypted payload in bytes */
  readonly sizeBytes: number;

  /** SHA-256 hash of the encrypted payload (hex) */
  readonly contentHash: string;

  /** ISO 8601 timestamp of upload */
  readonly uploadedAt: string;
}

export interface StorageContractConfig {
  /** Address of the deployed storage guarantee contract */
  readonly contractAddress: string;

  /** TON Storage Bag ID that the contract guarantees */
  readonly bagId: string;

  /** Duration of storage guarantee in seconds */
  readonly guaranteePeriodSec: number;

  /** Amount of Toncoin locked as storage payment (in nanotons) */
  readonly paymentNanotons: bigint;
}

export interface TonStorageClientConfig {
  /** TON network endpoint URL */
  readonly endpoint: string;

  /** Timeout for network requests in milliseconds */
  readonly timeoutMs: number;

  /** Maximum retries on transient failures */
  readonly maxRetries: number;
}

// ─── Profile Manager ─────────────────────────────────────────

export interface ProfileManagerDeps {
  /** Adapter for parsing natural language into RiskProfile */
  readonly intentParser: IntentParserAdapter;

  /** TON Storage configuration */
  readonly storageConfig: TonStorageClientConfig;
}

/** Result of a profile creation or update operation */
export interface ProfileOperationResult {
  readonly profile: UserProfile;
  readonly storageMeta: StorageBagMetadata;
  readonly storageContract: StorageContractConfig | null;
}
