/**
 * Strict types for DeDust MCP Server.
 * No `any` — all external data is validated through type guards.
 */

// ─── Pool / Liquidity Types ─────────────────────────────────

export interface DedustPool {
  /** Pool contract address */
  readonly address: string;

  /** Pool type: 'volatile' (x*y=k) or 'stable' (StableSwap) */
  readonly poolType: 'volatile' | 'stable';

  /** First token in the pair */
  readonly token0: DedustTokenInfo;

  /** Second token in the pair */
  readonly token1: DedustTokenInfo;

  /** Reserve of token0 in minimal units */
  readonly reserve0: string;

  /** Reserve of token1 in minimal units */
  readonly reserve1: string;

  /** Total value locked in USD */
  readonly tvlUsd: number;

  /** 24h trading volume in USD */
  readonly volume24hUsd: number;

  /** 24h fee revenue in USD */
  readonly fees24hUsd: number;

  /** Annualized fee APY (estimated from 24h fees / TVL * 365) */
  readonly feeApyPercent: number;

  /** Total LP token supply */
  readonly lpSupply: string;
}

export interface DedustTokenInfo {
  /** Token contract address (jetton master) or 'native' for TON */
  readonly address: string;

  /** Token symbol */
  readonly symbol: string;

  /** Token decimals */
  readonly decimals: number;

  /** Current price in USD (from oracle / pool ratio) */
  readonly priceUsd: number;
}

// ─── Tool Params ─────────────────────────────────────────────

export interface GetDedustLiquidityParams {
  /** Filter by minimum TVL in USD (default: 5000) */
  readonly minTvlUsd?: number;

  /** Filter by pool type: 'volatile', 'stable', or 'all' (default: 'all') */
  readonly poolType?: 'volatile' | 'stable' | 'all';

  /** Filter by token symbol */
  readonly tokenSymbol?: string;

  /** Maximum number of results (default: 20) */
  readonly limit?: number;

  /** Sort field */
  readonly sortBy?: 'tvl' | 'volume' | 'fees' | 'apy';
}

export interface AnalyzeImpermanentLossParams {
  /** Token 0 symbol */
  readonly token0Symbol: string;

  /** Token 1 symbol */
  readonly token1Symbol: string;

  /** Current price of token0 in USD */
  readonly token0PriceUsd: number;

  /** Current price of token1 in USD */
  readonly token1PriceUsd: number;

  /** Historical price volatility of token0 (annualized, as decimal) */
  readonly token0Volatility: number;

  /** Historical price volatility of token1 (annualized, as decimal) */
  readonly token1Volatility: number;

  /** Price correlation between token0 and token1 (-1 to 1) */
  readonly priceCorrelation: number;

  /** Time horizon for analysis in days (default: 30) */
  readonly horizonDays?: number;

  /** Number of Monte Carlo simulation paths (default: 1000) */
  readonly simulationPaths?: number;
}

// ─── IL Analysis Results ─────────────────────────────────────

export interface ImpermanentLossResult {
  /** Expected impermanent loss as decimal (e.g., 0.05 = 5%) */
  readonly expectedIlPercent: number;

  /** 95th percentile IL (worst case with 95% confidence) */
  readonly il95thPercentile: number;

  /** 5th percentile IL (best case) */
  readonly il5thPercentile: number;

  /** Risk assessment label */
  readonly riskLevel: 'low' | 'medium' | 'high' | 'extreme';

  /** Whether this pool is suitable for conservative investors */
  readonly conservativeSuitable: boolean;

  /** Scenario breakdown */
  readonly scenarios: readonly IlScenario[];

  /** Human-readable analysis summary */
  readonly summary: string;
}

export interface IlScenario {
  /** Scenario name */
  readonly name: string;

  /** Price ratio change (e.g., 2.0 = token0 doubled relative to token1) */
  readonly priceRatioChange: number;

  /** IL under this scenario */
  readonly ilPercent: number;

  /** Probability of this scenario (0..1) based on simulation */
  readonly probability: number;
}

// ─── Type Guards ─────────────────────────────────────────────

export function isValidLiquidityParams(value: unknown): value is GetDedustLiquidityParams {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (obj['minTvlUsd'] !== undefined && typeof obj['minTvlUsd'] !== 'number') return false;
  if (obj['poolType'] !== undefined && !['volatile', 'stable', 'all'].includes(obj['poolType'] as string)) return false;
  if (obj['tokenSymbol'] !== undefined && typeof obj['tokenSymbol'] !== 'string') return false;
  if (obj['limit'] !== undefined && typeof obj['limit'] !== 'number') return false;
  if (obj['sortBy'] !== undefined && !['tvl', 'volume', 'fees', 'apy'].includes(obj['sortBy'] as string)) return false;

  return true;
}

export function isValidIlParams(value: unknown): value is AnalyzeImpermanentLossParams {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj['token0Symbol'] !== 'string') return false;
  if (typeof obj['token1Symbol'] !== 'string') return false;
  if (typeof obj['token0PriceUsd'] !== 'number' || obj['token0PriceUsd'] as number <= 0) return false;
  if (typeof obj['token1PriceUsd'] !== 'number' || obj['token1PriceUsd'] as number <= 0) return false;
  if (typeof obj['token0Volatility'] !== 'number') return false;
  if (typeof obj['token1Volatility'] !== 'number') return false;
  if (typeof obj['priceCorrelation'] !== 'number') return false;

  return true;
}
