/**
 * MCP Tool: get_stonfi_quote
 *
 * Uses the Omniston protocol to discover the best swap price across
 * multiple resolvers (liquidity sources) via reactive RxJS streams.
 *
 * This is the core pricing tool for TradeMind's IntentEngine:
 * - User says "swap 100 TON for USDT"
 * - IntentEngine calls get_stonfi_quote via MCP
 * - Omniston streams quotes from multiple DEX resolvers
 * - Best quote is returned with routing path and settlement details
 * - IntentEngine uses the result to build a BOC transaction
 *
 * Security: Only financial parameters are sent to Omniston.
 * No user identifiers (Telegram ID, wallet address) are included
 * in the quote request. See CLAUDE.md §10.
 */

import { OmnistonClient, type OmnistonTransport } from '../lib/omniston-client.js';
import type {
  GetStonfiQuoteParams,
  QuoteDiscoveryResult,
} from '../types.js';

/**
 * Executes the get_stonfi_quote tool.
 *
 * @param params - Quote request (asset pair, amount, slippage)
 * @param transport - Omniston WebSocket transport (injected)
 * @returns Best quote discovery result with all alternatives
 *
 * @throws Error if no valid quotes found within timeout
 */
export async function executeStonfiQuote(
  params: GetStonfiQuoteParams,
  transport: OmnistonTransport,
): Promise<QuoteDiscoveryResult> {
  // Validate input amounts
  validateQuoteInput(params);

  const client = new OmnistonClient(transport);

  try {
    const result = await client.discoverBestQuote(params);
    return result;
  } finally {
    // Always clean up the WebSocket connection
    client.dispose();
  }
}

/**
 * Formats a quote discovery result as a human-readable summary
 * for injection into the LLM context window.
 */
export function formatQuoteSummary(result: QuoteDiscoveryResult): string {
  const best = result.bestQuote;

  const rateStr = best.exchangeRate.toFixed(6);
  const impactStr = (best.priceImpact * 100).toFixed(3);
  const routeStr = best.routePath.length > 0
    ? best.routePath.join(' → ')
    : 'direct';

  const lines = [
    `Best quote from resolver "${best.resolverId}":`,
    `  Offer: ${best.offerUnits} → Receive: ${best.askUnits}`,
    `  Rate: ${rateStr}`,
    `  Price impact: ${impactStr}%`,
    `  Route: ${routeStr}`,
    `  Settlement: ${best.settlementAddress}`,
    `  Expires: ${best.expiresAt}`,
    ``,
    `Discovery: ${result.resolversResponded} resolver(s) responded in ${result.discoveryTimeMs}ms`,
    `Total quotes: ${result.allQuotes.length}`,
  ];

  if (result.allQuotes.length > 1) {
    const worst = result.allQuotes[result.allQuotes.length - 1];
    const spread = (
      ((best.exchangeRate - worst.exchangeRate) / best.exchangeRate) * 100
    ).toFixed(2);
    lines.push(`Rate spread (best vs worst): ${spread}%`);
  }

  return lines.join('\n');
}

// ─── Validation ──────────────────────────────────────────────

function validateQuoteInput(params: GetStonfiQuoteParams): void {
  // Ensure offer amount is a valid positive number string
  const offerNum = Number(params.offerUnits);
  if (Number.isNaN(offerNum) || offerNum <= 0) {
    throw new Error(
      `Invalid offer amount: "${params.offerUnits}". Must be a positive number string.`,
    );
  }

  // Ensure addresses are non-empty
  if (params.offerAssetAddress.trim().length === 0) {
    throw new Error('offerAssetAddress cannot be empty');
  }
  if (params.askAssetAddress.trim().length === 0) {
    throw new Error('askAssetAddress cannot be empty');
  }

  // Self-swap check
  if (params.offerAssetAddress === params.askAssetAddress) {
    throw new Error(
      'offerAssetAddress and askAssetAddress must be different (cannot swap a token for itself)',
    );
  }

  // Slippage bounds
  if (params.maxSlippage !== undefined) {
    if (params.maxSlippage < 0 || params.maxSlippage > 0.5) {
      throw new Error(
        `Invalid maxSlippage: ${params.maxSlippage}. Must be between 0 and 0.5 (50%).`,
      );
    }
  }
}
