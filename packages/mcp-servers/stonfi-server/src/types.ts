/**
 * Strict types for STON.fi MCP Server.
 * No `any` — all data from external APIs is validated through type guards.
 */

// ─── Pool Types ──────────────────────────────────────────────

export interface StonfiPool {
  /** Pool contract address on TON */
  readonly address: string;

  /** First token in the pair */
  readonly token0: TokenInfo;

  /** Second token in the pair */
  readonly token1: TokenInfo;

  /** Total value locked in USD */
  readonly tvlUsd: number;

  /** Annualized percentage yield (estimated from fees) */
  readonly apyPercent: number;

  /** 24h trading volume in USD */
  readonly volume24hUsd: number;

  /** Pool fee tier (e.g., 0.003 = 0.3%) */
  readonly feeRate: number;

  /** Whether the pool is actively trading */
  readonly isActive: boolean;
}

export interface TokenInfo {
  /** Token contract address (jetton master) */
  readonly address: string;

  /** Token symbol (e.g., 'TON', 'USDT') */
  readonly symbol: string;

  /** Token decimals */
  readonly decimals: number;
}

// ─── Pool Filter Params ──────────────────────────────────────

export interface GetStonfiPoolsParams {
  /** Minimum TVL in USD (default: 10000) */
  readonly minTvlUsd?: number;

  /** Minimum APY percent (default: 0) */
  readonly minApyPercent?: number;

  /** Filter by specific token symbol (e.g., 'TON') */
  readonly tokenSymbol?: string;

  /** Maximum number of results (default: 20) */
  readonly limit?: number;

  /** Sort field */
  readonly sortBy?: 'tvl' | 'apy' | 'volume';
}

// ─── Quote Types (Omniston) ──────────────────────────────────

export interface GetStonfiQuoteParams {
  /** Source token address (jetton master) */
  readonly offerAssetAddress: string;

  /** Destination token address (jetton master) */
  readonly askAssetAddress: string;

  /** Amount to swap in source token units (as string for precision) */
  readonly offerUnits: string;

  /** Maximum acceptable slippage as decimal (e.g., 0.01 = 1%) */
  readonly maxSlippage?: number;

  /** Timeout for quote discovery in milliseconds (default: 10000) */
  readonly timeoutMs?: number;
}

export interface StonfiQuote {
  /** Source asset address */
  readonly offerAssetAddress: string;

  /** Destination asset address */
  readonly askAssetAddress: string;

  /** Amount offered (in minimal units, as string) */
  readonly offerUnits: string;

  /** Amount received (in minimal units, as string) */
  readonly askUnits: string;

  /** Exchange rate: askUnits / offerUnits */
  readonly exchangeRate: number;

  /** Price impact as a decimal (e.g., 0.005 = 0.5%) */
  readonly priceImpact: number;

  /** Routing path used for this quote */
  readonly routePath: readonly string[];

  /** ID of the resolver (DEX) that provided this quote */
  readonly resolverId: string;

  /** Quote settlement address for transaction building */
  readonly settlementAddress: string;

  /** Quote expiry timestamp (ISO 8601) */
  readonly expiresAt: string;
}

export interface QuoteDiscoveryResult {
  /** Best quote found */
  readonly bestQuote: StonfiQuote;

  /** All quotes received during discovery (sorted by rate, best first) */
  readonly allQuotes: readonly StonfiQuote[];

  /** Number of resolvers that responded */
  readonly resolversResponded: number;

  /** Total discovery time in milliseconds */
  readonly discoveryTimeMs: number;
}

// ─── Type Guards ─────────────────────────────────────────────

export function isValidPoolsParams(value: unknown): value is GetStonfiPoolsParams {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (obj['minTvlUsd'] !== undefined && typeof obj['minTvlUsd'] !== 'number') return false;
  if (obj['minApyPercent'] !== undefined && typeof obj['minApyPercent'] !== 'number') return false;
  if (obj['tokenSymbol'] !== undefined && typeof obj['tokenSymbol'] !== 'string') return false;
  if (obj['limit'] !== undefined && typeof obj['limit'] !== 'number') return false;
  if (obj['sortBy'] !== undefined && !['tvl', 'apy', 'volume'].includes(obj['sortBy'] as string)) return false;

  return true;
}

export function isValidQuoteParams(value: unknown): value is GetStonfiQuoteParams {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj['offerAssetAddress'] !== 'string') return false;
  if (typeof obj['askAssetAddress'] !== 'string') return false;
  if (typeof obj['offerUnits'] !== 'string') return false;
  if (obj['maxSlippage'] !== undefined && typeof obj['maxSlippage'] !== 'number') return false;
  if (obj['timeoutMs'] !== undefined && typeof obj['timeoutMs'] !== 'number') return false;

  return true;
}
