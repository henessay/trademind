/**
 * IntentEngine — Core Orchestrator
 *
 * The brain of TradeMind. Transforms a user's natural-language intent
 * into ranked, executable DeFi strategies.
 *
 * Chain of Thought (CoT):
 * ┌─────────────┐
 * │ 1. Profile   │ Load RiskProfile from Identity Hub
 * │    Context    │ (conservative / moderate / aggressive)
 * └──────┬───────┘
 *        ▼
 * ┌─────────────┐
 * │ 2. Pool      │ Query STON.fi + DeDust MCP servers
 * │    Discovery  │ with risk-aligned filters
 * └──────┬───────┘
 *        ▼
 * ┌─────────────┐
 * │ 3. IL Risk   │ Run Monte Carlo IL analysis
 * │    Analysis   │ for each candidate pool
 * └──────┬───────┘
 *        ▼
 * ┌─────────────┐
 * │ 4. Strategy  │ Score and rank by risk/reward
 * │    Ranking    │ weighted by RiskProfile
 * └──────┬───────┘
 *        ▼
 * ┌─────────────┐
 * │ 5. BOC       │ Build transaction payload
 * │    Generation │ for user confirmation
 * └─────────────┘
 *
 * Design principles:
 * - Dependency Injection for all external services
 * - Zero knowledge of private keys
 * - No Telegram ID in any MCP request
 * - Conservative-first: aggressive pools are only shown to aggressive users
 */

import type {
  UserProfile,
  RiskLevel,
  McpToolClient,
  NormalizedPool,
  IntentEngineResult,
  Strategy,
  TransactionPayload,
  TransactionChain,
} from '../types/intent.js';
import {
  fetchStonfiPools,
  fetchDedustPools,
  analyzeIl,
} from './mcp-client.js';
import {
  rankStrategies,
  type PoolWithIl,
} from './strategy-ranker.js';
import { buildStrategyTransaction } from '../modules/build-transaction-payload.js';
import {
  MIN_TVL_BY_RISK,
  PREFERRED_POOL_TYPES,
  MAX_IL_BY_RISK,
} from '../config/engine-config.js';

// ─── Error Types ─────────────────────────────────────────────

export class IntentEngineError extends Error {
  readonly code: IntentEngineErrorCode;

  constructor(message: string, code: IntentEngineErrorCode) {
    super(message);
    this.name = 'IntentEngineError';
    this.code = code;
  }
}

export type IntentEngineErrorCode =
  | 'PROFILE_MISSING'
  | 'NO_POOLS_FOUND'
  | 'NO_STRATEGIES_FOUND'
  | 'MCP_UNAVAILABLE'
  | 'TX_BUILD_FAILED';

// ─── IntentEngine ────────────────────────────────────────────

export class IntentEngine {
  private readonly mcpClient: McpToolClient;

  constructor(mcpClient: McpToolClient) {
    this.mcpClient = mcpClient;
  }

  /**
   * Discovers and ranks strategies for a user based on their profile.
   *
   * This is the main entry point. It:
   * 1. Reads the RiskProfile to determine search parameters
   * 2. Queries both STON.fi and DeDust via MCP for pools
   * 3. Runs IL analysis on each candidate pool
   * 4. Ranks pools by composite score (APY, IL, TVL, volume)
   * 5. Returns top strategies with explanations
   *
   * @param profile - User profile from Identity Hub
   * @returns Ranked strategies with metadata
   *
   * @throws IntentEngineError if no viable strategies found
   */
  async discoverStrategies(
    profile: UserProfile,
  ): Promise<IntentEngineResult> {
    const startTime = Date.now();
    const { riskLevel, timeHorizon, preferredAssets } = profile.riskProfile;

    // ── Step 1: Determine search parameters from profile ──
    const minTvl = MIN_TVL_BY_RISK[riskLevel];
    const preferredPoolTypes = PREFERRED_POOL_TYPES[riskLevel];
    const horizonDays = timeHorizonToDays(timeHorizon);

    // ── Step 2: Discover pools from both DEXes in parallel ──
    const tokenFilter = preferredAssets.length > 0
      ? preferredAssets[0]
      : undefined;

    const [stonfiPools, dedustPools] = await Promise.all([
      fetchStonfiPools(this.mcpClient, minTvl, tokenFilter),
      fetchDedustPools(
        this.mcpClient,
        minTvl,
        preferredPoolTypes.includes('stable') ? 'all' : 'volatile',
        tokenFilter,
      ),
    ]);

    const allPools = [...stonfiPools, ...dedustPools];
    const poolsScanned = allPools.length;

    if (poolsScanned === 0) {
      throw new IntentEngineError(
        'No liquidity pools found matching your criteria. ' +
        'Try adjusting your preferred assets or risk level.',
        'NO_POOLS_FOUND',
      );
    }

    // ── Step 3: Run IL analysis for each pool ──
    const poolsWithIl = await this.analyzePoolsIl(
      allPools,
      horizonDays,
    );

    // ── Step 4: Rank by risk/reward ──
    const strategies = rankStrategies(poolsWithIl, riskLevel);
    const poolsFiltered = strategies.length;

    if (poolsFiltered === 0) {
      throw new IntentEngineError(
        `No strategies pass the risk filters for "${riskLevel}" profile. ` +
        `Maximum IL threshold: ${(MAX_IL_BY_RISK[riskLevel] * 100).toFixed(1)}%. ` +
        'Consider adjusting your risk tolerance.',
        'NO_STRATEGIES_FOUND',
      );
    }

    const processingTimeMs = Date.now() - startTime;

    return {
      strategies,
      poolsScanned,
      poolsFiltered,
      processingTimeMs,
    };
  }

  /**
   * Builds a transaction for a confirmed strategy.
   *
   * Called when the user clicks "Confirm Strategy" in the Mini App.
   * Generates a BOC that the user signs via TON Connect.
   *
   * @param strategy - The strategy the user selected
   * @param walletAddress - User's wallet (from TON Connect)
   * @param offerAmount - Amount to invest (minimal units)
   * @param riskLevel - For slippage calculation
   * @param recipientAddress - Optional: different recipient for DeDust swaps
   * @returns Transaction payload or chain for TON Connect
   */
  buildTransaction(
    strategy: Strategy,
    walletAddress: string,
    offerAmount: string,
    riskLevel: RiskLevel,
    recipientAddress?: string,
  ): TransactionPayload | TransactionChain {
    try {
      return buildStrategyTransaction(
        strategy,
        walletAddress,
        offerAmount,
        riskLevel,
        recipientAddress,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Build failed';
      throw new IntentEngineError(
        `Failed to build transaction: ${msg}`,
        'TX_BUILD_FAILED',
      );
    }
  }

  // ─── Private: IL Analysis ────────────────────────────────────

  /**
   * Runs IL analysis on each pool in parallel.
   * Falls back gracefully if analysis fails for a pool.
   */
  private async analyzePoolsIl(
    pools: readonly NormalizedPool[],
    horizonDays: number,
  ): Promise<readonly PoolWithIl[]> {
    // Batch IL analysis — run up to 5 concurrently
    const batchSize = 5;
    const results: PoolWithIl[] = [];

    for (let i = 0; i < pools.length; i += batchSize) {
      const batch = pools.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (pool) => {
          const il = await this.analyzeSinglePoolIl(pool, horizonDays);
          return { pool, il } satisfies PoolWithIl;
        }),
      );
      results.push(...batchResults);
    }

    return results;
  }

  private async analyzeSinglePoolIl(
    pool: NormalizedPool,
    horizonDays: number,
  ): Promise<PoolWithIl['il']> {
    // Stablecoin pairs have near-zero IL
    if (pool.poolType === 'stable') {
      return {
        expectedIlPercent: 0.001,
        worstCaseIlPercent: 0.005,
        riskLevel: 'low',
        withinTolerance: true,
      };
    }

    // Estimate volatilities (in production, fetch from oracle/historical data)
    const vol0 = estimateVolatility(pool.token0Symbol);
    const vol1 = estimateVolatility(pool.token1Symbol);
    const correlation = estimateCorrelation(pool.token0Symbol, pool.token1Symbol);

    try {
      const result = await analyzeIl(
        this.mcpClient,
        pool.token0Symbol,
        pool.token1Symbol,
        1, // Placeholder price (IL is ratio-based, absolute prices don't matter)
        1,
        vol0,
        vol1,
        correlation,
        horizonDays,
      );

      if (result === null) return null;

      return {
        expectedIlPercent: result.expectedIlPercent,
        worstCaseIlPercent: result.il95thPercentile,
        riskLevel: result.riskLevel,
        withinTolerance: result.conservativeSuitable,
      };
    } catch {
      return null; // IL analysis failed — pool will be treated cautiously
    }
  }
}

// ─── Utility Functions ───────────────────────────────────────

function timeHorizonToDays(horizon: string): number {
  switch (horizon) {
    case 'short': return 30;
    case 'medium': return 180;
    case 'long': return 365;
    default: return 180;
  }
}

/**
 * Rough volatility estimates by token category.
 * In production, these come from a price oracle or historical API.
 */
function estimateVolatility(symbol: string): number {
  const stablecoins = ['USDT', 'USDC', 'DAI', 'JUSDT', 'JUSDC'];
  if (stablecoins.includes(symbol.toUpperCase())) return 0.02;

  const majors = ['TON', 'BTC', 'ETH', 'WBTC', 'WETH'];
  if (majors.includes(symbol.toUpperCase())) return 0.7;

  // Unknown tokens — assume high volatility
  return 1.2;
}

/**
 * Rough correlation estimates between token pairs.
 */
function estimateCorrelation(symbol0: string, symbol1: string): number {
  const stablecoins = ['USDT', 'USDC', 'DAI', 'JUSDT', 'JUSDC'];
  const s0 = symbol0.toUpperCase();
  const s1 = symbol1.toUpperCase();

  // Stablecoin pair: very high correlation
  if (stablecoins.includes(s0) && stablecoins.includes(s1)) return 0.99;

  // One stable, one volatile: low correlation
  if (stablecoins.includes(s0) || stablecoins.includes(s1)) return 0.1;

  // Both volatile majors: moderate correlation
  return 0.5;
}
