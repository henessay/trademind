/**
 * Impermanent Loss Calculator
 *
 * Mathematical engine for modeling impermanent loss (IL) risk in AMM pools.
 *
 * For a constant-product AMM (x*y=k), impermanent loss is:
 *   IL = 2 * sqrt(r) / (1 + r) - 1
 * where r = price_ratio_change (new_price / old_price of token0 relative to token1)
 *
 * This module provides:
 * 1. Deterministic IL calculation for a given price ratio
 * 2. Monte Carlo simulation for probabilistic IL estimation
 * 3. Risk classification aligned with user risk profiles from Identity Hub
 *
 * The Monte Carlo approach simulates correlated price paths using
 * geometric Brownian motion (GBM) with the Cholesky decomposition
 * for correlation between token prices.
 */

import type {
  AnalyzeImpermanentLossParams,
  ImpermanentLossResult,
  IlScenario,
} from '../types.js';

/** Default simulation paths */
const DEFAULT_SIMULATION_PATHS = 1000;

/** Default horizon in days */
const DEFAULT_HORIZON_DAYS = 30;

/** Maximum allowed simulation paths (prevent DoS) */
const MAX_SIMULATION_PATHS = 10_000;

/** IL thresholds for risk classification */
const IL_THRESHOLDS = {
  low: 0.02,        // < 2% IL
  medium: 0.05,     // 2-5% IL
  high: 0.15,       // 5-15% IL
  // > 15% = extreme
} as const;

/** Conservative investor max acceptable IL (from Identity Hub RiskProfile) */
const CONSERVATIVE_MAX_IL = 0.03; // 3%

// ─── Core IL Formula ─────────────────────────────────────────

/**
 * Calculates deterministic impermanent loss for a constant-product AMM.
 *
 * Formula: IL = 2 * sqrt(r) / (1 + r) - 1
 *
 * @param priceRatioChange - New price ratio / old price ratio
 *   e.g., if token0 doubles relative to token1, r = 2.0
 * @returns IL as a negative decimal (e.g., -0.0566 = 5.66% loss)
 */
export function calculateIl(priceRatioChange: number): number {
  if (priceRatioChange <= 0) {
    throw new Error('Price ratio change must be positive');
  }

  // For r=1 (no change), IL = 0
  if (priceRatioChange === 1) return 0;

  const sqrtR = Math.sqrt(priceRatioChange);
  return (2 * sqrtR) / (1 + priceRatioChange) - 1;
}

/**
 * Absolute value of IL (always positive for easier comparison).
 */
export function calculateIlAbsolute(priceRatioChange: number): number {
  return Math.abs(calculateIl(priceRatioChange));
}

// ─── Monte Carlo Simulation ─────────────────────────────────

/**
 * Runs a full IL risk analysis using Monte Carlo simulation.
 *
 * Algorithm:
 * 1. Generate correlated price paths for both tokens using GBM
 * 2. Compute the price ratio at the end of each path
 * 3. Calculate IL for each terminal ratio
 * 4. Compute statistics: mean, percentiles, distribution
 * 5. Classify risk and determine suitability for conservative investors
 *
 * @param params - Token volatilities, correlation, horizon
 * @returns Comprehensive IL analysis with risk classification
 */
export function analyzeImpermanentLoss(
  params: AnalyzeImpermanentLossParams,
): ImpermanentLossResult {
  const horizonDays = params.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const numPaths = Math.min(
    params.simulationPaths ?? DEFAULT_SIMULATION_PATHS,
    MAX_SIMULATION_PATHS,
  );

  // Validate inputs
  validateParams(params);

  // Time horizon in years (for annualized volatility)
  const T = horizonDays / 365;

  // Run Monte Carlo: generate terminal price ratios
  const terminalIls = runSimulation(
    params.token0Volatility,
    params.token1Volatility,
    params.priceCorrelation,
    T,
    numPaths,
  );

  // Sort for percentile calculation
  const sorted = [...terminalIls].sort((a, b) => a - b);

  // Statistics
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const p5 = sorted[Math.floor(sorted.length * 0.05)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  // Risk classification
  const riskLevel = classifyRisk(p95);
  const conservativeSuitable = p95 <= CONSERVATIVE_MAX_IL;

  // Build scenario breakdown
  const scenarios = buildScenarios(params);

  // Summary
  const summary = buildSummary(
    params,
    mean,
    p95,
    riskLevel,
    conservativeSuitable,
    horizonDays,
  );

  return {
    expectedIlPercent: roundTo4(mean),
    il95thPercentile: roundTo4(p95),
    il5thPercentile: roundTo4(p5),
    riskLevel,
    conservativeSuitable,
    scenarios,
    summary,
  };
}

// ─── Simulation Engine ───────────────────────────────────────

/**
 * Simulates correlated geometric Brownian motion for two assets
 * and returns the absolute IL for each terminal price ratio.
 */
function runSimulation(
  vol0: number,
  vol1: number,
  correlation: number,
  T: number,
  numPaths: number,
): readonly number[] {
  const results: number[] = [];

  // Cholesky decomposition for 2x2 correlation matrix
  // [ 1   ρ ]    [ L11  0   ]   [ L11  L21 ]
  // [ ρ   1 ] =  [ L21  L22 ] × [ 0    L22 ]
  const L11 = 1;
  const L21 = correlation;
  const L22 = Math.sqrt(1 - correlation * correlation);

  for (let i = 0; i < numPaths; i++) {
    // Generate two independent standard normal samples
    const z1 = boxMullerNormal();
    const z2 = boxMullerNormal();

    // Apply Cholesky to get correlated normals
    const w1 = L11 * z1;
    const w2 = L21 * z1 + L22 * z2;

    // GBM terminal prices (drift = 0 for risk-neutral simulation)
    // S(T) = S(0) * exp((-σ²/2)*T + σ*sqrt(T)*W)
    const price0Ratio = Math.exp((-vol0 * vol0 / 2) * T + vol0 * Math.sqrt(T) * w1);
    const price1Ratio = Math.exp((-vol1 * vol1 / 2) * T + vol1 * Math.sqrt(T) * w2);

    // Price ratio change = (new_p0/old_p0) / (new_p1/old_p1)
    const priceRatioChange = price0Ratio / price1Ratio;

    // Calculate absolute IL
    results.push(calculateIlAbsolute(priceRatioChange));
  }

  return results;
}

/**
 * Box-Muller transform: generates a standard normal random variable.
 */
function boxMullerNormal(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─── Scenario Builder ────────────────────────────────────────

function buildScenarios(
  params: AnalyzeImpermanentLossParams,
): readonly IlScenario[] {
  // Key scenarios: price moves -50%, -20%, 0%, +20%, +50%, +100%, +200%
  const ratios = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 3.0];
  const names = [
    `${params.token0Symbol} drops 50%`,
    `${params.token0Symbol} drops 20%`,
    'No price change',
    `${params.token0Symbol} rises 20%`,
    `${params.token0Symbol} rises 50%`,
    `${params.token0Symbol} doubles`,
    `${params.token0Symbol} triples`,
  ];

  return ratios.map((ratio, i) => ({
    name: names[i],
    priceRatioChange: ratio,
    ilPercent: roundTo4(calculateIlAbsolute(ratio)),
    probability: estimateScenarioProbability(
      ratio,
      params.token0Volatility,
      params.token1Volatility,
      params.priceCorrelation,
      (params.horizonDays ?? DEFAULT_HORIZON_DAYS) / 365,
    ),
  }));
}

/**
 * Estimates the probability of a given price ratio change
 * under the GBM model with correlated assets.
 */
function estimateScenarioProbability(
  targetRatio: number,
  vol0: number,
  vol1: number,
  correlation: number,
  T: number,
): number {
  // Variance of log(price_ratio) under correlated GBM
  const combinedVol = Math.sqrt(
    vol0 * vol0 + vol1 * vol1 - 2 * correlation * vol0 * vol1,
  );

  const logTarget = Math.log(targetRatio);
  const mean = -(combinedVol * combinedVol / 2) * T;
  const std = combinedVol * Math.sqrt(T);

  if (std === 0) return targetRatio === 1 ? 1 : 0;

  // Probability within ±10% of target ratio
  const zLow = (logTarget - Math.log(1.1) - mean) / std;
  const zHigh = (logTarget + Math.log(1.1) - mean) / std;

  return roundTo4(normalCdf(zHigh) - normalCdf(zLow));
}

/** Standard normal CDF approximation (Abramowitz & Stegun) */
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

// ─── Classification ──────────────────────────────────────────

function classifyRisk(il95: number): ImpermanentLossResult['riskLevel'] {
  if (il95 <= IL_THRESHOLDS.low) return 'low';
  if (il95 <= IL_THRESHOLDS.medium) return 'medium';
  if (il95 <= IL_THRESHOLDS.high) return 'high';
  return 'extreme';
}

// ─── Summary Builder ─────────────────────────────────────────

function buildSummary(
  params: AnalyzeImpermanentLossParams,
  mean: number,
  p95: number,
  risk: string,
  conservative: boolean,
  days: number,
): string {
  const pair = `${params.token0Symbol}/${params.token1Symbol}`;
  const lines = [
    `Impermanent loss analysis for ${pair} pool over ${days} days:`,
    `Expected IL: ${(mean * 100).toFixed(2)}%`,
    `Worst case (95% confidence): ${(p95 * 100).toFixed(2)}%`,
    `Risk level: ${risk.toUpperCase()}`,
    `Suitable for conservative investors: ${conservative ? 'YES' : 'NO'}`,
  ];

  if (!conservative) {
    lines.push(
      `⚠ This pool exceeds the ${(CONSERVATIVE_MAX_IL * 100).toFixed(0)}% IL threshold ` +
      'for conservative profiles. Consider stablecoin pairs instead.',
    );
  }

  return lines.join('\n');
}

// ─── Validation ──────────────────────────────────────────────

function validateParams(params: AnalyzeImpermanentLossParams): void {
  if (params.token0Volatility < 0 || params.token0Volatility > 10) {
    throw new Error(
      `Invalid token0Volatility: ${params.token0Volatility}. Expected 0..10 (annualized).`,
    );
  }
  if (params.token1Volatility < 0 || params.token1Volatility > 10) {
    throw new Error(
      `Invalid token1Volatility: ${params.token1Volatility}. Expected 0..10 (annualized).`,
    );
  }
  if (params.priceCorrelation < -1 || params.priceCorrelation > 1) {
    throw new Error(
      `Invalid priceCorrelation: ${params.priceCorrelation}. Expected -1..1.`,
    );
  }
}

function roundTo4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
