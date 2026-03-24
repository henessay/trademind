/**
 * TON Storage Client
 *
 * Handles uploading and downloading encrypted profile payloads
 * to/from the TON Storage decentralized network.
 *
 * TON Storage works similarly to BitTorrent but with blockchain-backed
 * guarantees: storage nodes are financially incentivized via smart contracts
 * to maintain data availability, and Merkle proofs verify integrity.
 *
 * Architecture:
 * 1. Encrypted payload → split into chunks → compute Merkle tree
 * 2. Upload chunks to TON Storage network → receive Bag ID
 * 3. Bag ID is stored in the user's profile for future retrieval
 * 4. Storage guarantee contract ensures persistence (see storage-contract.ts)
 */

import { createHash } from 'node:crypto';
import type {
  EncryptedPayload,
  StorageBagMetadata,
  TonStorageClientConfig,
} from '../types/profile.js';
import { serializePayload, deserializePayload } from '../crypto/profile-cipher.js';

/** Default configuration for TON Storage client */
const DEFAULT_CONFIG: TonStorageClientConfig = {
  endpoint: 'https://ton-storage.trademind.io',
  timeoutMs: 30_000,
  maxRetries: 3,
};

/**
 * Error thrown when TON Storage operations fail.
 * Contains structured information for proper error handling.
 */
export class TonStorageError extends Error {
  readonly code: TonStorageErrorCode;
  readonly isRetryable: boolean;

  constructor(
    message: string,
    code: TonStorageErrorCode,
    isRetryable: boolean = false,
  ) {
    super(message);
    this.name = 'TonStorageError';
    this.code = code;
    this.isRetryable = isRetryable;
  }
}

export type TonStorageErrorCode =
  | 'UPLOAD_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'BAG_NOT_FOUND'
  | 'INTEGRITY_CHECK_FAILED'
  | 'NETWORK_TIMEOUT'
  | 'INVALID_BAG_ID';

/**
 * TON Storage Client for uploading and downloading encrypted profiles.
 *
 * Uses Dependency Injection: the actual network transport is abstracted
 * behind the TonStorageTransport interface for testability.
 */
export class TonStorageClient {
  private readonly config: TonStorageClientConfig;
  private readonly transport: TonStorageTransport;

  constructor(
    transport: TonStorageTransport,
    config: Partial<TonStorageClientConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.transport = transport;
  }

  /**
   * Uploads an encrypted payload to TON Storage.
   *
   * @param payload - The encrypted profile payload
   * @returns Metadata including the Bag ID for future retrieval
   *
   * @throws TonStorageError on upload failure (with retry info)
   */
  async uploadBag(payload: EncryptedPayload): Promise<StorageBagMetadata> {
    const binaryData = serializePayload(payload);
    const contentHash = computeSha256(binaryData);

    let lastError: TonStorageError | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const bagId = await this.transport.upload(
          binaryData,
          this.config.endpoint,
          this.config.timeoutMs,
        );

        return {
          bagId,
          sizeBytes: binaryData.length,
          contentHash,
          uploadedAt: new Date().toISOString(),
        };
      } catch (error: unknown) {
        lastError = this.wrapError(error, 'UPLOAD_FAILED');

        if (!lastError.isRetryable || attempt === this.config.maxRetries) {
          throw lastError;
        }

        // Exponential backoff: 1s, 2s, 4s...
        await sleep(Math.pow(2, attempt - 1) * 1000);
      }
    }

    throw lastError ?? new TonStorageError(
      'Upload failed after all retries',
      'UPLOAD_FAILED',
    );
  }

  /**
   * Downloads and deserializes an encrypted payload from TON Storage.
   *
   * @param bagId - The Bag ID received during upload
   * @param expectedHash - Optional SHA-256 hash for integrity verification
   * @returns The deserialized EncryptedPayload (still encrypted — call decryptProfile next)
   *
   * @throws TonStorageError if bag not found, integrity check fails, or network error
   */
  async downloadBag(
    bagId: string,
    expectedHash?: string,
  ): Promise<EncryptedPayload> {
    validateBagId(bagId);

    let lastError: TonStorageError | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const binaryData = await this.transport.download(
          bagId,
          this.config.endpoint,
          this.config.timeoutMs,
        );

        // Verify integrity if expected hash is provided
        if (expectedHash !== undefined) {
          const actualHash = computeSha256(binaryData);
          if (actualHash !== expectedHash) {
            throw new TonStorageError(
              `Integrity check failed for bag ${bagId}. ` +
              `Expected hash: ${expectedHash}, got: ${actualHash}. ` +
              'Data may have been tampered with.',
              'INTEGRITY_CHECK_FAILED',
              false,
            );
          }
        }

        return deserializePayload(binaryData);
      } catch (error: unknown) {
        if (error instanceof TonStorageError && !error.isRetryable) {
          throw error;
        }

        lastError = this.wrapError(error, 'DOWNLOAD_FAILED');

        if (attempt === this.config.maxRetries) {
          throw lastError;
        }

        await sleep(Math.pow(2, attempt - 1) * 1000);
      }
    }

    throw lastError ?? new TonStorageError(
      'Download failed after all retries',
      'DOWNLOAD_FAILED',
    );
  }

  /**
   * Checks if a bag exists in TON Storage without downloading it.
   */
  async bagExists(bagId: string): Promise<boolean> {
    validateBagId(bagId);

    try {
      return await this.transport.exists(
        bagId,
        this.config.endpoint,
        this.config.timeoutMs,
      );
    } catch {
      return false;
    }
  }

  private wrapError(
    error: unknown,
    code: TonStorageErrorCode,
  ): TonStorageError {
    if (error instanceof TonStorageError) {
      return error;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = message.toLowerCase().includes('timeout');

    return new TonStorageError(
      message,
      isTimeout ? 'NETWORK_TIMEOUT' : code,
      isTimeout, // timeouts are retryable
    );
  }
}

// ─── Transport Interface (for Dependency Injection) ──────────

/**
 * Abstract transport layer for TON Storage network operations.
 * Implement this interface to integrate with the actual TON Storage daemon
 * or to create test mocks.
 */
export interface TonStorageTransport {
  /**
   * Upload binary data to TON Storage.
   * @returns The Bag ID assigned by the network
   */
  upload(
    data: Buffer,
    endpoint: string,
    timeoutMs: number,
  ): Promise<string>;

  /**
   * Download binary data from TON Storage by Bag ID.
   */
  download(
    bagId: string,
    endpoint: string,
    timeoutMs: number,
  ): Promise<Buffer>;

  /**
   * Check if a bag exists in the network.
   */
  exists(
    bagId: string,
    endpoint: string,
    timeoutMs: number,
  ): Promise<boolean>;
}

// ─── Utilities ───────────────────────────────────────────────

function computeSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function validateBagId(bagId: string): void {
  // TON Storage Bag IDs are 64 hex characters (256-bit hash)
  if (!/^[0-9a-fA-F]{64}$/.test(bagId)) {
    throw new TonStorageError(
      `Invalid Bag ID format: "${bagId}". Expected 64 hex characters.`,
      'INVALID_BAG_ID',
      false,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
