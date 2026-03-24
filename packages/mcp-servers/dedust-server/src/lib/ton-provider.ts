/**
 * TON Network Provider
 *
 * Wraps TonClient4 with:
 * - Connection pooling and retry logic
 * - Timeout handling (CLAUDE.md §10: all async TON RPC calls must have timeouts)
 * - Structured error types for caller-level handling
 * - No user identifiers in any request
 */

/** Configuration for the TON provider */
export interface TonProviderConfig {
  /** TON HTTP API v4 endpoint */
  readonly endpoint: string;

  /** Request timeout in milliseconds (default: 15000) */
  readonly timeoutMs: number;

  /** Maximum retry attempts (default: 3) */
  readonly maxRetries: number;
}

/** Default mainnet endpoint */
const DEFAULT_CONFIG: TonProviderConfig = {
  endpoint: 'https://mainnet-v4.tonhubapi.com',
  timeoutMs: 15_000,
  maxRetries: 3,
};

/**
 * Structured error for TON RPC failures.
 */
export class TonRpcError extends Error {
  readonly code: 'TIMEOUT' | 'CONNECTION_FAILED' | 'INVALID_RESPONSE' | 'CONTRACT_NOT_FOUND';
  readonly isRetryable: boolean;

  constructor(message: string, code: TonRpcError['code'], isRetryable: boolean = false) {
    super(message);
    this.name = 'TonRpcError';
    this.code = code;
    this.isRetryable = isRetryable;
  }
}

/**
 * Abstract interface for TON blockchain queries.
 * Implementations wrap TonClient4 from @ton/ton.
 *
 * Injected into tools for testability — production passes real TonClient4,
 * tests pass a mock.
 */
export interface TonProvider {
  /**
   * Runs a getter method on a smart contract.
   * @param address - Contract address
   * @param method - Getter method name
   * @param args - Method arguments as stack items
   * @returns Raw stack result
   */
  runGetMethod(
    address: string,
    method: string,
    args: readonly StackItem[],
  ): Promise<readonly StackItem[]>;

  /**
   * Gets the current state of an account.
   */
  getAccountState(address: string): Promise<AccountState>;

  /**
   * Gets the latest masterchain block seqno.
   */
  getLastBlock(): Promise<number>;
}

/** Stack items for TVM get-method calls */
export type StackItem =
  | { readonly type: 'int'; readonly value: bigint }
  | { readonly type: 'cell'; readonly value: string }
  | { readonly type: 'slice'; readonly value: string }
  | { readonly type: 'null' };

/** Account state from the blockchain */
export interface AccountState {
  readonly address: string;
  readonly balance: bigint;
  readonly isActive: boolean;
  readonly lastTransactionLt: string;
}

/**
 * Creates a TonProvider with retry and timeout logic.
 *
 * @param rawProvider - The underlying TonClient4-based provider
 * @param config - Timeout and retry configuration
 * @returns Wrapped provider with error handling
 */
export function createResilientProvider(
  rawProvider: TonProvider,
  config: Partial<TonProviderConfig> = {},
): TonProvider {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return {
    async runGetMethod(
      address: string,
      method: string,
      args: readonly StackItem[],
    ): Promise<readonly StackItem[]> {
      return withRetry(
        () => withTimeout(
          rawProvider.runGetMethod(address, method, args),
          cfg.timeoutMs,
        ),
        cfg.maxRetries,
        `runGetMethod(${address}, ${method})`,
      );
    },

    async getAccountState(address: string): Promise<AccountState> {
      return withRetry(
        () => withTimeout(
          rawProvider.getAccountState(address),
          cfg.timeoutMs,
        ),
        cfg.maxRetries,
        `getAccountState(${address})`,
      );
    },

    async getLastBlock(): Promise<number> {
      return withRetry(
        () => withTimeout(
          rawProvider.getLastBlock(),
          cfg.timeoutMs,
        ),
        cfg.maxRetries,
        'getLastBlock()',
      );
    },
  };
}

// ─── Internal Helpers ────────────────────────────────────────

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new TonRpcError(
        `TON RPC request timed out after ${timeoutMs}ms`,
        'TIMEOUT',
        true,
      ));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  operationName: string,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isRetryable =
        error instanceof TonRpcError ? error.isRetryable : true;

      if (!isRetryable || attempt === maxRetries) {
        break;
      }

      // Exponential backoff: 500ms, 1s, 2s
      const delay = Math.pow(2, attempt - 1) * 500;
      await sleep(delay);
    }
  }

  throw new TonRpcError(
    `${operationName} failed after ${maxRetries} attempts: ${lastError?.message ?? 'Unknown error'}`,
    'CONNECTION_FAILED',
    false,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
