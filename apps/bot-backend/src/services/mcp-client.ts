/**
 * MCP Client Adapter
 *
 * Provides a typed interface over raw MCP tool calls.
 * Normalizes responses from STON.fi and DeDust MCP servers
 * into the unified NormalizedPool format that IntentEngine consumes.
 *
 * All MCP requests contain ONLY financial parameters.
 * No user identifiers (Telegram ID, wallet address) are ever sent.
 * See CLAUDE.md §10.
 */

import type {
  McpToolClient,
  NormalizedPool,
  DexProtocol,
} from '../types/intent.js';
import {
  POOL_DISCOVERY_TIMEOUT_MS,
  QUOTE_TIMEOUT_MS,
} from '../config/engine-config.js';

/**
 * Fetches pools from the STON.fi MCP server and normalizes them.
 *
 * @param client - Injected MCP tool client
 * @param minTvlUsd - Minimum TVL filter
 * @param tokenSymbol - Optional token filter
 * @returns Normalized pool list
 */
export async function fetchStonfiPools(
  client: McpToolClient,
  minTvlUsd: number,
  tokenSymbol?: string,
): Promise<readonly NormalizedPool[]> {
  const params: Record<string, unknown> = {
    minTvlUsd,
    limit: 50,
    sortBy: 'tvl',
  };
  if (tokenSymbol !== undefined) {
    params['tokenSymbol'] = tokenSymbol;
  }

  try {
    const response = await client.callStonfiTool('get_stonfi_pools', params);

    if (response.isError === true) {
      console.error('[MCP:STON.fi] Pool fetch error:', response.content[0]?.text);
      return [];
    }

    // Second content block contains JSON data
    const jsonContent = response.content[1];
    if (jsonContent === undefined) return [];

    const pools: unknown = JSON.parse(jsonContent.text);
    if (!Array.isArray(pools)) return [];

    return pools.map((pool: unknown) => normalizeStonfiPool(pool));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[MCP:STON.fi] Failed to fetch pools: ${msg}`);
    return [];
  }
}

/**
 * Fetches pools from the DeDust MCP server and normalizes them.
 */
export async function fetchDedustPools(
  client: McpToolClient,
  minTvlUsd: number,
  poolType: 'volatile' | 'stable' | 'all' = 'all',
  tokenSymbol?: string,
): Promise<readonly NormalizedPool[]> {
  const params: Record<string, unknown> = {
    minTvlUsd,
    poolType,
    limit: 50,
    sortBy: 'tvl',
  };
  if (tokenSymbol !== undefined) {
    params['tokenSymbol'] = tokenSymbol;
  }

  try {
    const response = await client.callDedustTool('get_dedust_liquidity', params);

    if (response.isError === true) {
      console.error('[MCP:DeDust] Pool fetch error:', response.content[0]?.text);
      return [];
    }

    const jsonContent = response.content[1];
    if (jsonContent === undefined) return [];

    const pools: unknown = JSON.parse(jsonContent.text);
    if (!Array.isArray(pools)) return [];

    return pools.map((pool: unknown) => normalizeDedustPool(pool));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[MCP:DeDust] Failed to fetch pools: ${msg}`);
    return [];
  }
}

/**
 * Runs impermanent loss analysis for a token pair via DeDust MCP server.
 */
export async function analyzeIl(
  client: McpToolClient,
  token0Symbol: string,
  token1Symbol: string,
  token0PriceUsd: number,
  token1PriceUsd: number,
  token0Volatility: number,
  token1Volatility: number,
  priceCorrelation: number,
  horizonDays: number,
): Promise<IlAnalysisResult | null> {
  try {
    const response = await client.callDedustTool('analyze_impermanent_loss', {
      token0Symbol,
      token1Symbol,
      token0PriceUsd,
      token1PriceUsd,
      token0Volatility,
      token1Volatility,
      priceCorrelation,
      horizonDays,
      simulationPaths: 1000,
    });

    if (response.isError === true) return null;

    const jsonContent = response.content[1];
    if (jsonContent === undefined) return null;

    const parsed: unknown = JSON.parse(jsonContent.text);
    if (!isValidIlResult(parsed)) return null;

    return parsed;
  } catch {
    return null;
  }
}

// ─── Result Types ────────────────────────────────────────────

interface IlAnalysisResult {
  readonly expectedIlPercent: number;
  readonly il95thPercentile: number;
  readonly riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  readonly conservativeSuitable: boolean;
  readonly summary: string;
}

// ─── Normalizers ─────────────────────────────────────────────

function normalizeStonfiPool(raw: unknown): NormalizedPool {
  const obj = raw as Record<string, unknown>;
  const token0 = obj['token0'] as Record<string, unknown>;
  const token1 = obj['token1'] as Record<string, unknown>;

  return {
    address: String(obj['address']),
    protocol: 'stonfi' as DexProtocol,
    poolType: 'volatile', // STON.fi pools are constant-product by default
    token0Symbol: String(token0['symbol']),
    token0Address: String(token0['address']),
    token0Decimals: Number(token0['decimals']),
    token1Symbol: String(token1['symbol']),
    token1Address: String(token1['address']),
    token1Decimals: Number(token1['decimals']),
    tvlUsd: Number(obj['tvlUsd']),
    apyPercent: Number(obj['apyPercent']),
    volume24hUsd: Number(obj['volume24hUsd']),
    fees24hUsd: Number(obj['volume24hUsd']) * Number(obj['feeRate'] ?? 0.003),
  };
}

function normalizeDedustPool(raw: unknown): NormalizedPool {
  const obj = raw as Record<string, unknown>;
  const token0 = obj['token0'] as Record<string, unknown>;
  const token1 = obj['token1'] as Record<string, unknown>;

  return {
    address: String(obj['address']),
    protocol: 'dedust' as DexProtocol,
    poolType: obj['poolType'] === 'stable' ? 'stable' : 'volatile',
    token0Symbol: String(token0['symbol']),
    token0Address: String(token0['address']),
    token0Decimals: Number(token0['decimals']),
    token1Symbol: String(token1['symbol']),
    token1Address: String(token1['address']),
    token1Decimals: Number(token1['decimals']),
    tvlUsd: Number(obj['tvlUsd']),
    apyPercent: Number(obj['feeApyPercent']),
    volume24hUsd: Number(obj['volume24hUsd']),
    fees24hUsd: Number(obj['fees24hUsd']),
  };
}

// ─── Type Guard ──────────────────────────────────────────────

function isValidIlResult(value: unknown): value is IlAnalysisResult {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['expectedIlPercent'] === 'number' &&
    typeof obj['il95thPercentile'] === 'number' &&
    typeof obj['riskLevel'] === 'string' &&
    typeof obj['conservativeSuitable'] === 'boolean'
  );
}
