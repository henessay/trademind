/**
 * Transaction Payload Builder — Dispatcher
 *
 * Central module that compiles BOC (Bag of Cells) transaction payloads
 * for execution on the TON blockchain.
 *
 * This is the bridge between IntentEngine's strategy decisions and
 * the actual on-chain operations. It:
 *
 * 1. Takes a Strategy + user parameters
 * 2. Routes to the correct DEX-specific builder (STON.fi or DeDust)
 * 3. Returns a TransactionPayload (or TransactionChain) ready for TON Connect
 *
 * Security invariants:
 * - All input parameters are validated before BOC construction
 * - Slippage is capped at ABSOLUTE_MAX_SLIPPAGE (5%)
 * - No private keys are accessed — signing is client-side
 * - recipientAddress defaults to senderAddress unless explicitly overridden
 *
 * @see CLAUDE.md §7 (Architectural patterns)
 * @see CLAUDE.md §10 (Security)
 */

import type {
  Strategy,
  SwapParams,
  AddLiquidityParams,
  TransactionPayload,
  TransactionChain,
  DexProtocol,
  RiskLevel,
} from '../types/intent.js';
import {
  buildStonfiSwap,
  buildStonfiAddLiquidity,
} from './stonfi-tx-builder.js';
import {
  buildDedustSwap,
  buildDedustAddLiquidity,
} from './dedust-tx-builder.js';
import {
  MAX_SLIPPAGE,
  ABSOLUTE_MAX_SLIPPAGE,
  TRADEMIND_REFERRAL_ADDR,
} from '../config/engine-config.js';

// ─── Main Dispatcher ─────────────────────────────────────────

/**
 * Builds a swap transaction payload for the specified DEX protocol.
 *
 * @param protocol - Target DEX ('stonfi' or 'dedust')
 * @param params - Swap parameters including recipientAddress
 * @returns TransactionPayload with BOC for TON Connect
 *
 * @throws Error if protocol is unknown or params are invalid
 */
export function buildSwapPayload(
  protocol: DexProtocol,
  params: SwapParams,
): TransactionPayload {
  validateSlippage(params.maxSlippage);

  switch (protocol) {
    case 'stonfi':
      return buildStonfiSwap(params);
    case 'dedust':
      return buildDedustSwap(params);
    default:
      throw new Error(`Unknown DEX protocol: ${String(protocol)}`);
  }
}

/**
 * Builds an add-liquidity transaction chain for the specified DEX.
 *
 * @param protocol - Target DEX
 * @param params - Liquidity parameters
 * @returns TransactionChain with ordered messages
 */
export function buildAddLiquidityPayload(
  protocol: DexProtocol,
  params: AddLiquidityParams,
): TransactionChain {
  switch (protocol) {
    case 'stonfi':
      return buildStonfiAddLiquidity(params);
    case 'dedust':
      return buildDedustAddLiquidity(params);
    default:
      throw new Error(`Unknown DEX protocol: ${String(protocol)}`);
  }
}

/**
 * Builds a complete transaction from a Strategy object.
 *
 * This is the high-level API used by IntentEngine when the user
 * confirms a strategy. It extracts all necessary parameters and
 * routes to the correct builder.
 *
 * @param strategy - The confirmed strategy
 * @param walletAddress - User's TON wallet address
 * @param offerAmount - Amount to invest (minimal units, as string)
 * @param riskLevel - User's risk level (determines slippage)
 * @param recipientAddress - Optional: recipient for output tokens
 *   Defaults to walletAddress if not specified.
 *   When different, enables forwarding (DeDust swapParams.recipientAddress).
 * @returns TransactionPayload or TransactionChain
 */
export function buildStrategyTransaction(
  strategy: Strategy,
  walletAddress: string,
  offerAmount: string,
  riskLevel: RiskLevel,
  recipientAddress?: string,
): TransactionPayload | TransactionChain {
  const recipient = recipientAddress ?? walletAddress;
  const slippage = getSlippageForRisk(riskLevel);

  switch (strategy.type) {
    case 'swap': {
      const [token0Addr, token1Addr] = extractTokenAddresses(strategy);
      const swapParams: SwapParams = {
        offerAssetAddress: token0Addr,
        askAssetAddress: token1Addr,
        offerAmount,
        minAskAmount: calculateMinAskAmount(offerAmount, slippage),
        senderAddress: walletAddress,
        recipientAddress: recipient,
        maxSlippage: slippage,
        referralAddress: TRADEMIND_REFERRAL_ADDR,
      };
      return buildSwapPayload(strategy.protocol, swapParams);
    }

    case 'add_liquidity': {
      const [token0Addr, token1Addr] = extractTokenAddresses(strategy);
      // Split offer amount 50/50 between both tokens (simplified)
      const halfAmount = (BigInt(offerAmount) / 2n).toString();
      const lpParams: AddLiquidityParams = {
        poolAddress: strategy.poolAddress,
        token0Address: token0Addr,
        token1Address: token1Addr,
        amount0: halfAmount,
        amount1: halfAmount,
        minLpAmount: '1', // Minimum 1 LP token (slippage handled by amounts)
        senderAddress: walletAddress,
      };
      return buildAddLiquidityPayload(strategy.protocol, lpParams);
    }

    case 'stake':
      // Staking transactions are single-token deposits
      // Route through swap builder with pool as recipient
      throw new Error('Stake strategy transactions not yet implemented');

    default:
      throw new Error(`Unknown strategy type: ${String(strategy.type)}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function getSlippageForRisk(riskLevel: RiskLevel): number {
  return MAX_SLIPPAGE[riskLevel];
}

function validateSlippage(slippage: number): void {
  if (slippage < 0) {
    throw new Error('Slippage cannot be negative');
  }
  if (slippage > ABSOLUTE_MAX_SLIPPAGE) {
    throw new Error(
      `Slippage ${(slippage * 100).toFixed(1)}% exceeds absolute maximum ` +
      `${(ABSOLUTE_MAX_SLIPPAGE * 100).toFixed(1)}%`,
    );
  }
}

/**
 * Calculates minimum ask amount after applying slippage.
 * minAsk = offerAmount * (1 - slippage)
 * (Simplified — in production, use the actual exchange rate from the quote)
 */
function calculateMinAskAmount(offerAmount: string, slippage: number): string {
  const offer = BigInt(offerAmount);
  const slippageBps = BigInt(Math.round(slippage * 10_000));
  const minAsk = offer - (offer * slippageBps) / 10_000n;
  return minAsk > 0n ? minAsk.toString() : '1';
}

/**
 * Extracts token addresses from a strategy's pair string and pool data.
 * In production, this would use the actual pool data from MCP response.
 */
function extractTokenAddresses(
  strategy: Strategy,
): [string, string] {
  // Pool address encodes the pair — in production, resolve from pool state
  // For now, return placeholder addresses that the frontend must resolve
  return [
    `${strategy.poolAddress}:token0`,
    `${strategy.poolAddress}:token1`,
  ];
}
