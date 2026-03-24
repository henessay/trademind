/**
 * MCP Tool: analyze_impermanent_loss
 *
 * Provides impermanent loss risk analysis for DeDust liquidity pools.
 * Uses Monte Carlo simulation with correlated geometric Brownian motion
 * to model potential IL scenarios.
 *
 * This tool is critical for TradeMind's IntentEngine:
 * - When a conservative user asks to invest, IntentEngine calls this tool
 * - If IL risk exceeds the user's RiskProfile threshold, the pool is rejected
 * - Only pools with conservativeSuitable=true are presented to conservative users
 *
 * The tool requires no user data — only token volatilities and correlation,
 * which are public market data.
 */

import {
  analyzeImpermanentLoss,
  calculateIlAbsolute,
} from '../lib/il-calculator.js';
import type {
  AnalyzeImpermanentLossParams,
  ImpermanentLossResult,
} from '../types.js';

/**
 * Executes the analyze_impermanent_loss tool.
 *
 * @param params - Token pair volatility data and simulation config
 * @returns Full IL analysis with risk classification and scenarios
 */
export function executeImpermanentLossAnalysis(
  params: AnalyzeImpermanentLossParams,
): ImpermanentLossResult {
  return analyzeImpermanentLoss(params);
}

/**
 * Quick IL estimate for a specific price move — no simulation needed.
 * Useful for showing "what if token X moves by Y%" to the user.
 */
export function quickIlEstimate(
  priceChangePercent: number,
): { readonly ilPercent: number; readonly description: string } {
  const ratio = 1 + priceChangePercent / 100;

  if (ratio <= 0) {
    return {
      ilPercent: 100,
      description: 'Total loss: token price went to zero.',
    };
  }

  const il = calculateIlAbsolute(ratio);

  return {
    ilPercent: Math.round(il * 10_000) / 100,
    description: `If one token moves ${priceChangePercent}% relative to the other, ` +
      `impermanent loss would be approximately ${(il * 100).toFixed(2)}%.`,
  };
}

/**
 * Formats IL analysis result as a human-readable summary for LLM context.
 */
export function formatIlAnalysis(result: ImpermanentLossResult): string {
  const lines = [
    result.summary,
    '',
    'Scenario breakdown:',
    ...result.scenarios.map(
      (s) => `  ${s.name}: IL ${(s.ilPercent * 100).toFixed(2)}% ` +
        `(probability: ${(s.probability * 100).toFixed(1)}%)`,
    ),
  ];

  return lines.join('\n');
}
