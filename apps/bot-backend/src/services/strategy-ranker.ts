/**
 * Strategy Ranker
 *
 * Scores and ranks liquidity pools based on a composite metric that
 * balances yield, risk, stability, and liquidity — weighted by the
 * user's RiskProfile from Identity Hub.
 *
 * Scoring formula:
 *   score = w_apy * norm(apy) + w_il * norm(1 - il) + w_tvl * norm(tvl) + w_vol * norm(vol)
 *
 * Where:
 * - norm() = min-max normalization within the pool set (0..1)
 * - Weights shift based on risk level:
 *   conservative → ilSafety dominates
 *   aggressive → APY dominates
 */

import type {
  NormalizedPool,
  IlRiskSummary,
  RiskLevel,
  Strategy,
  DexProtocol,
} from '../types/intent.js';
import {
  SCORE_WEIGHTS,
  MAX_STRATEGIES,
  MAX_IL_BY_RISK,
} from '../config/engine-config.js';

/** IL data resolved for a pool (may be null if analysis failed) */
export interface PoolWithIl {
  readonly pool: NormalizedPool;
  readonly il: IlRiskSummary | null;
}

/**
 * Scores and ranks pools, producing Strategy objects.
 *
 * @param pools - Pools with IL data
 * @param riskLevel - User's risk level
 * @param maxStrategies - Max results (default: MAX_STRATEGIES)
 * @returns Ranked strategies, best first
 */
export function rankStrategies(
  pools: readonly PoolWithIl[],
  riskLevel: RiskLevel,
  maxStrategies: number = MAX_STRATEGIES,
): readonly Strategy[] {
  if (pools.length === 0) return [];

  // Adjust weights based on risk level
  const weights = adjustWeights(riskLevel);

  // Filter out pools that exceed risk tolerance
  const maxIl = MAX_IL_BY_RISK[riskLevel];
  const eligible = pools.filter((p) => {
    if (p.il === null) return riskLevel === 'aggressive'; // unknown IL: aggressive only
    return p.il.worstCaseIlPercent <= maxIl;
  });

  if (eligible.length === 0) return [];

  // Compute normalization ranges
  const apys = eligible.map((p) => p.pool.apyPercent);
  const tvls = eligible.map((p) => p.pool.tvlUsd);
  const vols = eligible.map((p) => p.pool.volume24hUsd);
  const ils = eligible.map((p) => p.il?.worstCaseIlPercent ?? 0);

  const apyRange = minMax(apys);
  const tvlRange = minMax(tvls);
  const volRange = minMax(vols);
  const ilRange = minMax(ils);

  // Score each pool
  const scored = eligible.map((poolWithIl) => {
    const { pool, il } = poolWithIl;

    const normApy = normalize(pool.apyPercent, apyRange);
    const normTvl = normalize(pool.tvlUsd, tvlRange);
    const normVol = normalize(pool.volume24hUsd, volRange);
    // IL is inverted: lower IL = higher safety score
    const ilValue = il?.worstCaseIlPercent ?? 0;
    const normIlSafety = 1 - normalize(ilValue, ilRange);

    const rawScore =
      weights.apy * normApy +
      weights.ilSafety * normIlSafety +
      weights.tvl * normTvl +
      weights.volume * normVol;

    // Scale to 0-100
    const score = Math.round(rawScore * 100);

    return { poolWithIl, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Build Strategy objects for top N
  return scored
    .slice(0, maxStrategies)
    .map(({ poolWithIl, score }, index) =>
      buildStrategy(poolWithIl, score, index, riskLevel),
    );
}

// ─── Weight Adjustment ───────────────────────────────────────

interface AdjustedWeights {
  readonly apy: number;
  readonly ilSafety: number;
  readonly tvl: number;
  readonly volume: number;
}

function adjustWeights(riskLevel: RiskLevel): AdjustedWeights {
  const base = SCORE_WEIGHTS;

  switch (riskLevel) {
    case 'conservative':
      // Safety-first: boost IL safety, reduce APY chasing
      return {
        apy: base.apyWeight * 0.6,
        ilSafety: base.ilSafetyWeight * 1.6,
        tvl: base.tvlWeight * 1.3,
        volume: base.volumeWeight * 0.8,
      };
    case 'aggressive':
      // Yield-first: boost APY, reduce safety
      return {
        apy: base.apyWeight * 1.5,
        ilSafety: base.ilSafetyWeight * 0.5,
        tvl: base.tvlWeight * 0.7,
        volume: base.volumeWeight * 1.2,
      };
    case 'moderate':
    default:
      return {
        apy: base.apyWeight,
        ilSafety: base.ilSafetyWeight,
        tvl: base.tvlWeight,
        volume: base.volumeWeight,
      };
  }
}

// ─── Strategy Builder ────────────────────────────────────────

function buildStrategy(
  poolWithIl: PoolWithIl,
  score: number,
  index: number,
  riskLevel: RiskLevel,
): Strategy {
  const { pool, il } = poolWithIl;
  const pair = `${pool.token0Symbol}/${pool.token1Symbol}`;

  const ilRisk: IlRiskSummary = il ?? {
    expectedIlPercent: 0,
    worstCaseIlPercent: 0,
    riskLevel: 'low',
    withinTolerance: true,
  };

  const rationale = buildRationale(pool, ilRisk, score, riskLevel);

  return {
    id: `strategy-${pool.protocol}-${index}-${Date.now()}`,
    name: `${pool.poolType === 'stable' ? 'Stable' : 'Volatile'} LP: ${pair} on ${formatProtocol(pool.protocol)}`,
    type: 'add_liquidity',
    protocol: pool.protocol,
    poolAddress: pool.address,
    pair,
    estimatedApyPercent: pool.apyPercent,
    poolTvlUsd: pool.tvlUsd,
    volume24hUsd: pool.volume24hUsd,
    ilRisk,
    score,
    rationale,
    transactionPayload: null, // Built later when user confirms
  };
}

function buildRationale(
  pool: NormalizedPool,
  il: IlRiskSummary,
  score: number,
  riskLevel: RiskLevel,
): string {
  const pair = `${pool.token0Symbol}/${pool.token1Symbol}`;
  const parts: string[] = [];

  parts.push(
    `Пул ${pair} на ${formatProtocol(pool.protocol)} (${pool.poolType}) ` +
    `с TVL $${formatNumber(pool.tvlUsd)} и APY ${pool.apyPercent.toFixed(2)}%.`,
  );

  if (il.riskLevel === 'low') {
    parts.push('Риск непостоянных потерь низкий.');
  } else if (il.riskLevel === 'medium') {
    parts.push(
      `Ожидаемые непостоянные потери: ${(il.expectedIlPercent * 100).toFixed(2)}% ` +
      `(худший случай: ${(il.worstCaseIlPercent * 100).toFixed(2)}%).`,
    );
  } else {
    parts.push(
      `⚠ Повышенный риск IL: до ${(il.worstCaseIlPercent * 100).toFixed(2)}%.`,
    );
  }

  if (pool.poolType === 'stable' && riskLevel === 'conservative') {
    parts.push(
      'Стабильный пул: пара стейблкойнов минимизирует волатильность.',
    );
  }

  parts.push(`Оценка стратегии: ${score}/100.`);

  return parts.join(' ');
}

// ─── Helpers ─────────────────────────────────────────────────

interface Range {
  readonly min: number;
  readonly max: number;
}

function minMax(values: readonly number[]): Range {
  if (values.length === 0) return { min: 0, max: 1 };
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function normalize(value: number, range: Range): number {
  if (range.max === range.min) return 0.5;
  return (value - range.min) / (range.max - range.min);
}

function formatProtocol(protocol: DexProtocol): string {
  return protocol === 'stonfi' ? 'STON.fi' : 'DeDust';
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
