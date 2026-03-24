/**
 * Tests for Impermanent Loss Calculator
 *
 * Validates:
 * - Deterministic IL formula against known values
 * - Monte Carlo simulation statistical properties
 * - Risk classification thresholds
 * - Edge cases (zero volatility, perfect correlation)
 */

import { describe, it, expect } from 'vitest';
import {
  calculateIl,
  calculateIlAbsolute,
  analyzeImpermanentLoss,
} from '../src/lib/il-calculator.js';
import type { AnalyzeImpermanentLossParams } from '../src/types.js';

// ─── Deterministic IL Formula ────────────────────────────────

describe('calculateIl (deterministic)', () => {
  it('should return 0 for no price change (r=1)', () => {
    expect(calculateIl(1.0)).toBe(0);
  });

  it('should return ~-5.72% for 2x price change', () => {
    // IL(2) = 2*sqrt(2)/(1+2) - 1 = 2*1.4142/3 - 1 ≈ -0.0572
    const il = calculateIl(2.0);
    expect(il).toBeCloseTo(-0.0572, 3);
  });

  it('should return ~-5.72% for 0.5x price change (symmetric)', () => {
    // IL is symmetric: IL(r) = IL(1/r)
    const il = calculateIl(0.5);
    expect(il).toBeCloseTo(-0.0572, 3);
  });

  it('should return ~-20.0% for 5x price change', () => {
    const il = calculateIl(5.0);
    expect(il).toBeLessThan(-0.13);
    expect(il).toBeGreaterThan(-0.26);
  });

  it('should approach -100% as price ratio diverges extremely', () => {
    const il = calculateIl(10000);
    expect(il).toBeLessThan(-0.95);
  });

  it('should always be negative or zero', () => {
    const ratios = [0.01, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 100.0];
    for (const r of ratios) {
      expect(calculateIl(r)).toBeLessThanOrEqual(0);
    }
  });

  it('should throw for non-positive ratio', () => {
    expect(() => calculateIl(0)).toThrow();
    expect(() => calculateIl(-1)).toThrow();
  });
});

describe('calculateIlAbsolute', () => {
  it('should return positive values', () => {
    expect(calculateIlAbsolute(2.0)).toBeCloseTo(0.0572, 3);
    expect(calculateIlAbsolute(0.5)).toBeCloseTo(0.0572, 3);
  });
});

// ─── Monte Carlo Simulation ─────────────────────────────────

describe('analyzeImpermanentLoss (Monte Carlo)', () => {
  const baseParams: AnalyzeImpermanentLossParams = {
    token0Symbol: 'TON',
    token1Symbol: 'USDT',
    token0PriceUsd: 5.0,
    token1PriceUsd: 1.0,
    token0Volatility: 0.8,
    token1Volatility: 0.05,
    priceCorrelation: 0.1,
    horizonDays: 30,
    simulationPaths: 2000,
  };

  it('should return valid IL analysis structure', () => {
    const result = analyzeImpermanentLoss(baseParams);

    expect(result.expectedIlPercent).toBeGreaterThanOrEqual(0);
    expect(result.expectedIlPercent).toBeLessThan(1);
    expect(result.il95thPercentile).toBeGreaterThanOrEqual(result.expectedIlPercent);
    expect(result.il5thPercentile).toBeLessThanOrEqual(result.expectedIlPercent);
    expect(['low', 'medium', 'high', 'extreme']).toContain(result.riskLevel);
    expect(typeof result.conservativeSuitable).toBe('boolean');
    expect(result.scenarios.length).toBeGreaterThan(0);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('should classify stablecoin pairs as low risk', () => {
    const stableParams: AnalyzeImpermanentLossParams = {
      ...baseParams,
      token0Symbol: 'USDT',
      token1Symbol: 'USDC',
      token0PriceUsd: 1.0,
      token1PriceUsd: 1.0,
      token0Volatility: 0.01,
      token1Volatility: 0.01,
      priceCorrelation: 0.99,
    };

    const result = analyzeImpermanentLoss(stableParams);

    expect(result.riskLevel).toBe('low');
    expect(result.conservativeSuitable).toBe(true);
    expect(result.expectedIlPercent).toBeLessThan(0.01);
  });

  it('should classify highly volatile uncorrelated pairs as high/extreme risk', () => {
    const volatileParams: AnalyzeImpermanentLossParams = {
      ...baseParams,
      token0Volatility: 1.5,
      token1Volatility: 1.5,
      priceCorrelation: -0.5,
      horizonDays: 90,
    };

    const result = analyzeImpermanentLoss(volatileParams);

    expect(['high', 'extreme']).toContain(result.riskLevel);
    expect(result.conservativeSuitable).toBe(false);
  });

  it('should produce deterministic no-change scenario at IL=0%', () => {
    const result = analyzeImpermanentLoss(baseParams);
    const noChange = result.scenarios.find((s) => s.priceRatioChange === 1.0);

    expect(noChange).toBeDefined();
    expect(noChange?.ilPercent).toBe(0);
  });

  it('should include 7 scenarios covering -50% to 3x', () => {
    const result = analyzeImpermanentLoss(baseParams);
    expect(result.scenarios.length).toBe(7);

    const ratios = result.scenarios.map((s) => s.priceRatioChange);
    expect(ratios).toContain(0.5);
    expect(ratios).toContain(1.0);
    expect(ratios).toContain(2.0);
    expect(ratios).toContain(3.0);
  });

  it('should handle zero volatility (constant prices)', () => {
    const zeroVol: AnalyzeImpermanentLossParams = {
      ...baseParams,
      token0Volatility: 0,
      token1Volatility: 0,
      priceCorrelation: 0,
    };

    const result = analyzeImpermanentLoss(zeroVol);

    // With zero volatility, prices don't move, so IL should be 0
    expect(result.expectedIlPercent).toBe(0);
    expect(result.riskLevel).toBe('low');
  });

  it('should reject invalid volatility', () => {
    const bad: AnalyzeImpermanentLossParams = {
      ...baseParams,
      token0Volatility: -0.5,
    };

    expect(() => analyzeImpermanentLoss(bad)).toThrow('Invalid');
  });

  it('should reject invalid correlation', () => {
    const bad: AnalyzeImpermanentLossParams = {
      ...baseParams,
      priceCorrelation: 1.5,
    };

    expect(() => analyzeImpermanentLoss(bad)).toThrow('Invalid');
  });
});
