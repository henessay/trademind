/**
 * MCP Tool: get_stonfi_pools
 *
 * Fetches and filters STON.fi liquidity pools by TVL, APY, and token.
 * Returns anonymized pool data — no user identifiers are included.
 *
 * Used by IntentEngine to discover candidate pools for conservative
 * strategies (stablecoin pairs, high-TVL pools with low IL risk).
 */

import type {
  StonfiPool,
  GetStonfiPoolsParams,
  TokenInfo,
} from '../types.js';

/** Default minimum TVL filter in USD */
const DEFAULT_MIN_TVL_USD = 10_000;

/** Default result limit */
const DEFAULT_LIMIT = 20;

/** Maximum result limit to prevent excessive data transfer */
const MAX_LIMIT = 100;

/**
 * Interface for the STON.fi pool data source.
 * Injected for testability — production uses @ston-fi/api.
 */
export interface StonfiPoolDataSource {
  fetchPools(): Promise<readonly RawPoolData[]>;
}

/** Raw pool data as returned by the STON.fi API */
interface RawPoolData {
  readonly address: string;
  readonly token0_address: string;
  readonly token0_symbol: string;
  readonly token0_decimals: number;
  readonly token1_address: string;
  readonly token1_symbol: string;
  readonly token1_decimals: number;
  readonly tvl_usd: number;
  readonly apy: number;
  readonly volume_24h: number;
  readonly fee_rate: number;
  readonly is_active: boolean;
}

/**
 * Executes the get_stonfi_pools tool.
 *
 * Pipeline:
 * 1. Fetch all pools from STON.fi API
 * 2. Map to strict types
 * 3. Apply filters (TVL, APY, token)
 * 4. Sort by requested field
 * 5. Limit results
 *
 * @param params - Filter and sort parameters
 * @param dataSource - Injected pool data source
 * @returns Filtered and sorted pool list
 */
export async function executeStonfiPools(
  params: GetStonfiPoolsParams,
  dataSource: StonfiPoolDataSource,
): Promise<readonly StonfiPool[]> {
  const minTvl = params.minTvlUsd ?? DEFAULT_MIN_TVL_USD;
  const minApy = params.minApyPercent ?? 0;
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const sortBy = params.sortBy ?? 'tvl';

  // Fetch raw pool data
  const rawPools = await dataSource.fetchPools();

  // Transform → filter → sort → limit
  const result = rawPools
    .map(mapRawPool)
    .filter((pool) => pool.isActive)
    .filter((pool) => pool.tvlUsd >= minTvl)
    .filter((pool) => pool.apyPercent >= minApy)
    .filter((pool) => {
      if (params.tokenSymbol === undefined) return true;
      const symbol = params.tokenSymbol.toUpperCase();
      return (
        pool.token0.symbol.toUpperCase() === symbol ||
        pool.token1.symbol.toUpperCase() === symbol
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'apy': return b.apyPercent - a.apyPercent;
        case 'volume': return b.volume24hUsd - a.volume24hUsd;
        case 'tvl':
        default: return b.tvlUsd - a.tvlUsd;
      }
    })
    .slice(0, limit);

  return result;
}

/**
 * Formats pool data as a human-readable summary for the LLM context.
 */
export function formatPoolsSummary(pools: readonly StonfiPool[]): string {
  if (pools.length === 0) {
    return 'No STON.fi pools match the specified filters.';
  }

  const lines = pools.map((pool, index) => {
    const pair = `${pool.token0.symbol}/${pool.token1.symbol}`;
    const tvl = formatUsd(pool.tvlUsd);
    const apy = pool.apyPercent.toFixed(2);
    const vol = formatUsd(pool.volume24hUsd);
    const fee = (pool.feeRate * 100).toFixed(2);

    return (
      `${index + 1}. ${pair} — TVL: ${tvl}, APY: ${apy}%, ` +
      `Vol 24h: ${vol}, Fee: ${fee}%`
    );
  });

  return `Found ${pools.length} STON.fi pool(s):\n${lines.join('\n')}`;
}

// ─── Internal ────────────────────────────────────────────────

function mapRawPool(raw: RawPoolData): StonfiPool {
  const token0: TokenInfo = {
    address: raw.token0_address,
    symbol: raw.token0_symbol,
    decimals: raw.token0_decimals,
  };
  const token1: TokenInfo = {
    address: raw.token1_address,
    symbol: raw.token1_symbol,
    decimals: raw.token1_decimals,
  };

  return {
    address: raw.address,
    token0,
    token1,
    tvlUsd: raw.tvl_usd,
    apyPercent: raw.apy,
    volume24hUsd: raw.volume_24h,
    feeRate: raw.fee_rate,
    isActive: raw.is_active,
  };
}

function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(2)}`;
}
