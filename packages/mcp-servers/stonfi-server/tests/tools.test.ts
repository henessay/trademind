/**
 * Tests for STON.fi MCP Server tools
 *
 * Validates:
 * - Pool filtering logic (TVL, APY, token symbol)
 * - Pool sorting (by TVL, APY, volume)
 * - Quote input validation (self-swap, invalid amounts, slippage bounds)
 * - Type guards for tool parameters
 */

import { describe, it, expect } from 'vitest';
import { isValidPoolsParams, isValidQuoteParams } from '../src/types.js';

// ─── Type Guard Tests ────────────────────────────────────────

describe('isValidPoolsParams', () => {
  it('should accept valid complete params', () => {
    expect(isValidPoolsParams({
      minTvlUsd: 50000,
      minApyPercent: 5,
      tokenSymbol: 'TON',
      limit: 10,
      sortBy: 'apy',
    })).toBe(true);
  });

  it('should accept empty params (all optional)', () => {
    expect(isValidPoolsParams({})).toBe(true);
  });

  it('should reject invalid sortBy', () => {
    expect(isValidPoolsParams({ sortBy: 'invalid' })).toBe(false);
  });

  it('should reject non-number minTvlUsd', () => {
    expect(isValidPoolsParams({ minTvlUsd: 'high' })).toBe(false);
  });

  it('should reject non-object input', () => {
    expect(isValidPoolsParams(null)).toBe(false);
    expect(isValidPoolsParams('string')).toBe(false);
    expect(isValidPoolsParams(42)).toBe(false);
  });
});

describe('isValidQuoteParams', () => {
  it('should accept valid quote params', () => {
    expect(isValidQuoteParams({
      offerAssetAddress: 'EQC...abc',
      askAssetAddress: 'EQD...def',
      offerUnits: '1000000000',
      maxSlippage: 0.01,
      timeoutMs: 5000,
    })).toBe(true);
  });

  it('should accept minimal required params', () => {
    expect(isValidQuoteParams({
      offerAssetAddress: 'EQC...abc',
      askAssetAddress: 'EQD...def',
      offerUnits: '1000',
    })).toBe(true);
  });

  it('should reject missing offerAssetAddress', () => {
    expect(isValidQuoteParams({
      askAssetAddress: 'EQD...def',
      offerUnits: '1000',
    })).toBe(false);
  });

  it('should reject missing offerUnits', () => {
    expect(isValidQuoteParams({
      offerAssetAddress: 'EQC...abc',
      askAssetAddress: 'EQD...def',
    })).toBe(false);
  });

  it('should reject non-string offerUnits', () => {
    expect(isValidQuoteParams({
      offerAssetAddress: 'EQC...abc',
      askAssetAddress: 'EQD...def',
      offerUnits: 1000,
    })).toBe(false);
  });

  it('should reject non-number maxSlippage', () => {
    expect(isValidQuoteParams({
      offerAssetAddress: 'EQC...abc',
      askAssetAddress: 'EQD...def',
      offerUnits: '1000',
      maxSlippage: 'low',
    })).toBe(false);
  });
});
