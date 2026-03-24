/**
 * MCP Tool: get_dedust_liquidity
 *
 * Fetches DeDust liquidity pool metrics using TonClient4 and the
 * DeDust Factory contract at MAINNET_FACTORY_ADDR.
 *
 * Architecture:
 * 1. Query DeDust Factory to enumerate pools
 * 2. For each pool: call get-methods to read reserves, LP supply
 * 3. Compute derived metrics: TVL, fees, APY
 * 4. Filter and sort by requested criteria
 *
 * All queries go through the TonProvider wrapper which ensures
 * timeout handling and retry logic (see ton-provider.ts).
 *
 * No user identifiers are included in any blockchain query.
 */

import type { TonProvider } from '../lib/ton-provider.js';
import type {
  DedustPool,
  DedustTokenInfo,
  GetDedustLiquidityParams,
} from '../types.js';

/** DeDust V2 Factory address on mainnet */
export const MAINNET_FACTORY_ADDR =
  'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67';

/** Default minimum TVL */
const DEFAULT_MIN_TVL_USD = 5_000;

/** Default result limit */
const DEFAULT_LIMIT = 20;

/** Maximum result limit */
const MAX_LIMIT = 100;

/**
 * Interface for DeDust pool data fetching.
 * In production, this wraps DeDust SDK + TonClient4.
 * In tests, this is mocked.
 */
export interface DedustPoolDataSource {
  /**
   * Fetches all pools from the DeDust Factory.
   * Uses MAINNET_FACTORY_ADDR and TonClient4 get-methods.
   */
  fetchPools(): Promise<readonly RawDedustPool[]>;
}

/** Raw pool data from DeDust SDK / on-chain get-methods */
interface RawDedustPool {
  readonly address: string;
  readonly pool_type: 'volatile' | 'stable';
  readonly token0_address: string;
  readonly token0_symbol: string;
  readonly token0_decimals: number;
  readonly token0_price_usd: number;
  readonly token1_address: string;
  readonly token1_symbol: string;
  readonly token1_decimals: number;
  readonly token1_price_usd: number;
  readonly reserve0: string;
  readonly reserve1: string;
  readonly lp_supply: string;
  readonly volume_24h_usd: number;
  readonly fees_24h_usd: number;
}

/**
 * Executes the get_dedust_liquidity tool.
 *
 * @param params - Filter and sort parameters
 * @param dataSource - Injected DeDust data source
 * @returns Filtered, enriched pool list
 */
export async function executeDedustLiquidity(
  params: GetDedustLiquidityParams,
  dataSource: DedustPoolDataSource,
): Promise<readonly DedustPool[]> {
  const minTvl = params.minTvlUsd ?? DEFAULT_MIN_TVL_USD;
  const poolType = params.poolType ?? 'all';
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const sortBy = params.sortBy ?? 'tvl';

  const rawPools = await dataSource.fetchPools();

  const result = rawPools
    .map(mapRawPool)
    .filter((pool) => pool.tvlUsd >= minTvl)
    .filter((pool) => {
      if (poolType === 'all') return true;
      return pool.poolType === poolType;
    })
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
        case 'volume': return b.volume24hUsd - a.volume24hUsd;
        case 'fees': return b.fees24hUsd - a.fees24hUsd;
        case 'apy': return b.feeApyPercent - a.feeApyPercent;
        case 'tvl':
        default: return b.tvlUsd - a.tvlUsd;
      }
    })
    .slice(0, limit);

  return result;
}

/**
 * Formats pool data as a human-readable summary for LLM context.
 */
export function formatLiquiditySummary(pools: readonly DedustPool[]): string {
  if (pools.length === 0) {
    return 'No DeDust pools match the specified filters.';
  }

  const lines = pools.map((pool, i) => {
    const pair = `${pool.token0.symbol}/${pool.token1.symbol}`;
    const type = pool.poolType === 'stable' ? '[Stable]' : '[Volatile]';
    const tvl = formatUsd(pool.tvlUsd);
    const apy = pool.feeApyPercent.toFixed(2);
    const vol = formatUsd(pool.volume24hUsd);
    const fees = formatUsd(pool.fees24hUsd);

    return (
      `${i + 1}. ${type} ${pair} — TVL: ${tvl}, Fee APY: ${apy}%, ` +
      `Vol 24h: ${vol}, Fees 24h: ${fees}`
    );
  });

  return `Found ${pools.length} DeDust pool(s):\n${lines.join('\n')}`;
}

// ─── Internal ────────────────────────────────────────────────

function mapRawPool(raw: RawDedustPool): DedustPool {
  const token0: DedustTokenInfo = {
    address: raw.token0_address,
    symbol: raw.token0_symbol,
    decimals: raw.token0_decimals,
    priceUsd: raw.token0_price_usd,
  };

  const token1: DedustTokenInfo = {
    address: raw.token1_address,
    symbol: raw.token1_symbol,
    decimals: raw.token1_decimals,
    priceUsd: raw.token1_price_usd,
  };

  // Calculate TVL from reserves and prices
  const reserve0Num = Number(raw.reserve0) / Math.pow(10, raw.token0_decimals);
  const reserve1Num = Number(raw.reserve1) / Math.pow(10, raw.token1_decimals);
  const tvlUsd = reserve0Num * raw.token0_price_usd + reserve1Num * raw.token1_price_usd;

  // Estimate fee APY from 24h fees
  const feeApyPercent = tvlUsd > 0
    ? (raw.fees_24h_usd / tvlUsd) * 365 * 100
    : 0;

  return {
    address: raw.address,
    poolType: raw.pool_type,
    token0,
    token1,
    reserve0: raw.reserve0,
    reserve1: raw.reserve1,
    tvlUsd: Math.round(tvlUsd * 100) / 100,
    volume24hUsd: raw.volume_24h_usd,
    fees24hUsd: raw.fees_24h_usd,
    feeApyPercent: Math.round(feeApyPercent * 100) / 100,
    lpSupply: raw.lp_supply,
  };
}

function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(2)}`;
}
