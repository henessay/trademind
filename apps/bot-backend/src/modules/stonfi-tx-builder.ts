/**
 * STON.fi Transaction Builder
 *
 * Compiles BOC (Bag of Cells) payloads for STON.fi operations:
 * - Jetton swaps via Router V2
 * - Native TON swaps
 * - Add liquidity
 *
 * Security: This module only BUILDS the transaction data.
 * The actual signing happens client-side via TON Connect.
 * No private keys are ever accessed here. See CLAUDE.md §7.
 *
 * Uses @ston-fi/sdk for message construction and @ton/core for BOC serialization.
 */

import {
  Address,
  beginCell,
  toNano,
  type Cell,
} from '@ton/core';
import type {
  SwapParams,
  AddLiquidityParams,
  TransactionPayload,
  TransactionChain,
} from '../types/intent.js';
import {
  STONFI_ROUTER_ADDR,
  TRADEMIND_REFERRAL_ADDR,
  FORWARD_GAS_AMOUNT_NANOTONS,
  MIN_GAS_RESERVE_NANOTONS,
  ABSOLUTE_MAX_SLIPPAGE,
} from '../config/engine-config.js';

// ─── Op-Codes ────────────────────────────────────────────────

/** STON.fi Router V2 op-codes */
const OP_SWAP = 0x25938561;
const OP_PROVIDE_LP = 0xfcf9e58f;

/** Jetton standard op-code for transfer */
const OP_JETTON_TRANSFER = 0xf8a7ea5;

// ─── Swap Builder ────────────────────────────────────────────

/**
 * Builds a swap transaction for STON.fi.
 *
 * For jetton→jetton swaps, the flow is:
 * 1. Send jettons to the Router via jetton_transfer
 * 2. Router forward_payload contains the swap instruction
 * 3. Router executes the swap and sends output tokens to recipient
 *
 * For native TON→jetton swaps:
 * 1. Send TON directly to the Router with swap payload
 *
 * @param params - Swap parameters with validated slippage
 * @returns TransactionPayload ready for TON Connect signing
 */
export function buildStonfiSwap(params: SwapParams): TransactionPayload {
  validateSwapParams(params);

  const isNativeTonSwap = params.offerAssetAddress === 'native';

  if (isNativeTonSwap) {
    return buildNativeTonSwap(params);
  }

  return buildJettonSwap(params);
}

/**
 * Builds an add-liquidity transaction for STON.fi.
 *
 * Requires two sequential messages:
 * 1. Transfer token0 to the pool with provide_lp payload
 * 2. Transfer token1 to the pool with provide_lp payload
 *
 * @param params - Liquidity provision parameters
 * @returns TransactionChain with two ordered messages
 */
export function buildStonfiAddLiquidity(
  params: AddLiquidityParams,
): TransactionChain {
  validateLiquidityParams(params);

  const senderAddr = Address.parse(params.senderAddress);
  const poolAddr = Address.parse(params.poolAddress);

  // Message 1: Send token0 to pool
  const lpPayload0 = buildProvideLpForwardPayload(
    senderAddr,
    BigInt(params.minLpAmount),
  );

  const msg0 = buildJettonTransferMessage(
    Address.parse(params.token0Address),
    poolAddr,
    senderAddr,
    BigInt(params.amount0),
    lpPayload0,
  );

  // Message 2: Send token1 to pool
  const lpPayload1 = buildProvideLpForwardPayload(
    senderAddr,
    BigInt(params.minLpAmount),
  );

  const msg1 = buildJettonTransferMessage(
    Address.parse(params.token1Address),
    poolAddr,
    senderAddr,
    BigInt(params.amount1),
    lpPayload1,
  );

  const gasPerMsg = FORWARD_GAS_AMOUNT_NANOTONS + MIN_GAS_RESERVE_NANOTONS;
  const totalAmount = gasPerMsg * 2n;

  return {
    messages: [msg0, msg1],
    totalAmount: totalAmount.toString(),
    estimatedGas: (gasPerMsg * 2n).toString(),
    summary: `Add liquidity to STON.fi pool: ${params.amount0} token0 + ${params.amount1} token1`,
  };
}

// ─── Internal Builders ───────────────────────────────────────

function buildNativeTonSwap(params: SwapParams): TransactionPayload {
  const routerAddr = Address.parse(STONFI_ROUTER_ADDR);
  const askJettonAddr = Address.parse(params.askAssetAddress);
  const recipientAddr = Address.parse(params.recipientAddress);

  const referralAddr = params.referralAddress !== null
    ? Address.parse(params.referralAddress)
    : Address.parse(TRADEMIND_REFERRAL_ADDR);

  // Build the swap body for Router V2
  const swapBody = beginCell()
    .storeUint(OP_SWAP, 32)              // op: swap
    .storeUint(0, 64)                     // query_id
    .storeCoins(BigInt(params.minAskAmount))  // min_out
    .storeAddress(askJettonAddr)          // ask_jetton_wallet_address
    .storeAddress(recipientAddr)          // recipient
    .storeAddress(referralAddr)           // referral_address
    .endCell();

  // For native TON swap, send TON directly to router
  const offerAmount = BigInt(params.offerAmount);
  const totalAmount = offerAmount + FORWARD_GAS_AMOUNT_NANOTONS;

  return {
    to: routerAddr.toString(),
    amount: totalAmount.toString(),
    payload: swapBody.toBoc().toString('base64'),
    stateInit: null,
  };
}

function buildJettonSwap(params: SwapParams): TransactionPayload {
  const routerAddr = Address.parse(STONFI_ROUTER_ADDR);
  const askJettonAddr = Address.parse(params.askAssetAddress);
  const senderAddr = Address.parse(params.senderAddress);
  const recipientAddr = Address.parse(params.recipientAddress);

  const referralAddr = params.referralAddress !== null
    ? Address.parse(params.referralAddress)
    : Address.parse(TRADEMIND_REFERRAL_ADDR);

  // Forward payload: swap instruction embedded in jetton transfer
  const swapForwardPayload = beginCell()
    .storeUint(OP_SWAP, 32)
    .storeUint(0, 64)
    .storeCoins(BigInt(params.minAskAmount))
    .storeAddress(askJettonAddr)
    .storeAddress(recipientAddr)
    .storeBit(true)                       // has_referral
    .storeAddress(referralAddr)
    .endCell();

  // Build the outer jetton_transfer message
  return buildJettonTransferMessage(
    Address.parse(params.offerAssetAddress),
    routerAddr,
    senderAddr,
    BigInt(params.offerAmount),
    swapForwardPayload,
  );
}

function buildJettonTransferMessage(
  jettonMasterAddr: Address,
  destinationAddr: Address,
  senderAddr: Address,
  amount: bigint,
  forwardPayload: Cell,
): TransactionPayload {
  const body = beginCell()
    .storeUint(OP_JETTON_TRANSFER, 32)    // op: jetton_transfer
    .storeUint(0, 64)                      // query_id
    .storeCoins(amount)                    // amount
    .storeAddress(destinationAddr)         // destination
    .storeAddress(senderAddr)              // response_destination
    .storeBit(false)                       // no custom_payload
    .storeCoins(FORWARD_GAS_AMOUNT_NANOTONS)  // forward_ton_amount
    .storeBit(true)                        // forward_payload in reference
    .storeRef(forwardPayload)
    .endCell();

  // The user sends this to their jetton wallet, not the master
  // In practice, the frontend resolves the jetton wallet address
  const totalAmount = FORWARD_GAS_AMOUNT_NANOTONS + MIN_GAS_RESERVE_NANOTONS;

  return {
    to: jettonMasterAddr.toString(), // Frontend must resolve to wallet
    amount: totalAmount.toString(),
    payload: body.toBoc().toString('base64'),
    stateInit: null,
  };
}

function buildProvideLpForwardPayload(
  owner: Address,
  minLpOut: bigint,
): Cell {
  return beginCell()
    .storeUint(OP_PROVIDE_LP, 32)
    .storeUint(0, 64)
    .storeAddress(owner)
    .storeCoins(minLpOut)
    .endCell();
}

// ─── Validation ──────────────────────────────────────────────

function validateSwapParams(params: SwapParams): void {
  if (params.maxSlippage > ABSOLUTE_MAX_SLIPPAGE) {
    throw new Error(
      `Slippage ${params.maxSlippage} exceeds absolute max ${ABSOLUTE_MAX_SLIPPAGE}`,
    );
  }

  const offerAmount = BigInt(params.offerAmount);
  if (offerAmount <= 0n) {
    throw new Error('Offer amount must be positive');
  }

  const minAsk = BigInt(params.minAskAmount);
  if (minAsk <= 0n) {
    throw new Error('Minimum ask amount must be positive');
  }

  Address.parse(params.senderAddress);
  Address.parse(params.recipientAddress);

  if (params.offerAssetAddress !== 'native') {
    Address.parse(params.offerAssetAddress);
  }
  Address.parse(params.askAssetAddress);
}

function validateLiquidityParams(params: AddLiquidityParams): void {
  if (BigInt(params.amount0) <= 0n || BigInt(params.amount1) <= 0n) {
    throw new Error('Both token amounts must be positive');
  }

  Address.parse(params.poolAddress);
  Address.parse(params.senderAddress);
  Address.parse(params.token0Address);
  Address.parse(params.token1Address);
}
