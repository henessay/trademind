/**
 * Identity Hub — Public API
 *
 * Cryptographic user profile storage for TradeMind:
 * - ProfileManager: orchestrates create / load / update lifecycle
 * - Crypto: AES-256-GCM encryption with keys derived from TON Connect signatures
 * - Parsers: natural language → RiskProfile via LLM adapter
 * - Storage: TON Storage upload/download with guarantee contracts
 */

// ─── Core orchestrator ───────────────────────────────────────
export {
  ProfileManager,
  ProfileManagerError,
  type ProfileErrorCode,
} from './profile-manager.js';

// ─── Types ───────────────────────────────────────────────────
export type {
  RiskProfile,
  RiskLevel,
  TimeHorizon,
  UserProfile,
  EncryptedPayload,
  DerivedKeyMaterial,
  ParsedIntent,
  IntentParserAdapter,
  StorageBagMetadata,
  StorageContractConfig,
  TonStorageClientConfig,
  ProfileManagerDeps,
  ProfileOperationResult,
} from './types/profile.js';

// ─── Crypto ──────────────────────────────────────────────────
export {
  deriveEncryptionKey,
  validateSignatureEntropy,
  SIGNING_CHALLENGE,
  encryptProfile,
  decryptProfile,
  serializePayload,
  deserializePayload,
} from './crypto/index.js';

// ─── Parsers ─────────────────────────────────────────────────
export {
  validateLlmResponse,
  needsClarification,
  buildClarificationPrompt,
  createIntentParserAdapter,
  INTENT_EXTRACTION_PROMPT,
} from './parsers/index.js';

// ─── Storage ─────────────────────────────────────────────────
export {
  TonStorageClient,
  TonStorageError,
  type TonStorageErrorCode,
  type TonStorageTransport,
  buildStorageContractDeployment,
  buildStorageTopUp,
  buildStorageClose,
  calculateStorageCost,
  parseStorageContractState,
  type DeployStorageContractParams,
  type StorageContractTransaction,
} from './storage/index.js';
