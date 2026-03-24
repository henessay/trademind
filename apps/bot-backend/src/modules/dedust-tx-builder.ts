/**
 * DeDust Transaction Builder
 *
 * Compiles BOC payloads for DeDust V2 operations:
 * - Jetton swaps via MAINNET_FACTORY_ADDR
 * - Native TON swaps via Native Vault
 * - Add liquidity to volatile and stable pools
 *
 * KEY FEATURE: swapParams.recipientAddress
 * DeDust allows specifying a different recipient for the output tokens.
 * If recipientAddress differs from senderAddress, the swap output goes
 * to the specified recipient. This is critical for:
 * - Payment forwarding (user buys tokens, sends to another wallet)
 * - Multi-step strategies (swap → route to LP pool in one flow)
 * - Gift transactions (buy tokens for someone else)
 *
 * Architecture (TON actor model):
 * DeDust uses a message chain pattern:
 * 1. User → Vault: deposit tokens
 * 2. Vault → Pool: execute swap
 * 3. Pool → Vault: release output tokens
 * 4. Vault → Recipient: send tokens to recipientAddress
 *
 * The recipientAddress is encoded in step 1 and propagated through
 * the entire chain via the TON actor messaging system.
 *
 * Security: BOC is built here, signed client-side via TON Connect.
 * No private keys. See CLAUDE.md §7.
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
  DEDUST_FACTORY_ADDR,
  DEDUST_NATIVE_VAULT_ADDR,
  FORWARD_GAS_AMOUNT_NANOTONS,
  MIN_GAS_RESERVE_NANOTONS,
  ABSOLUTE_MAX_SLIPPAGE,
} from '../config/engine-config.js';

// ─── DeDust V2 Op-Codes ─────────────────────────────────────

/** Swap operation via Vault */
const OP_DEDUST_SWAP = 0xe3a0d482;

/** Deposit liquidity */
const OP_DEDUST_DEPOSIT_LIQUIDITY = 0x40e108d6;

/** Jetton standard transfer */
const OP_JETTON_TRANSFER = 0xf8a7ea5;

/** Native TON deposit to Vault */
const OP_NATIVE_DEPOSIT = 0xb56b9598;

// ─── Swap Builder ────────────────────────────────────────────

/**
 * Builds a DeDust swap transaction with recipientAddress support.
 *
 * swapParams.recipientAddress behavior:
 * - If recipientAddress === senderAddress: standard self-swap
 * - If recipientAddress !== senderAddress: output tokens go to recipient
 *
 * This is encoded in the swap payload's `recipient` field, which DeDust
 * propagates through the Vault → Pool → Vault → Recipient message chain.
 *
 * @param params - Swap parameters with recipientAddress
 * @returns TransactionPayload for TON Connect
 *
 * @example
 * ```ts
 * // Standard swap (tokens come back to sender)
 * buildDedustSwap({
 *   senderAddress: 'EQUser...',
 *   recipientAddress: 'EQUser...',  // same as sender
 *   ...
 * });
 *
 * // Forward swap (tokens go to different wallet)
 * buildDedustSwap({
 *   senderAddress: 'EQUser...',
 *   recipientAddress: 'EQOther...',  // different from sender!
 *   ...
 * });
 * ```
 */
export function buildDedustSwap(params: SwapParams): TransactionPayload {
  validateSwapParams(params);

  const isNativeTon = params.offerAssetAddress === 'native';

  if (isNativeTon) {
    return buildNativeTonSwap(params);
  }

  return buildJettonSwap(params);
}

/**
 * Builds a DeDust add-liquidity transaction.
 *
 * For DeDust V2, adding liquidity requires:
 * 1. Deposit token0 to the pool via its Vault
 * 2. Deposit token1 to the pool via its Vault
 *
 * @param params - Liquidity provision parameters
 * @returns TransactionChain with two ordered messages
 */
export function buildDedustAddLiquidity(
  params: AddLiquidityParams,
): TransactionChain {
  validateLiquidityParams(params);

  const poolAddr = Address.parse(params.poolAddress);
  const senderAddr = Address.parse(params.senderAddress);

  // Message 1: Deposit token0
  const deposit0Payload = buildDepositLiquidityPayload(
    poolAddr,
    BigInt(params.amount0),
    BigInt(params.minLpAmount),
  );

  const msg0 = buildJettonTransferForDeposit(
    Address.parse(params.token0Address),
    senderAddr,
    BigInt(params.amount0),
    deposit0Payload,
  );

  // Message 2: Deposit token1
  const deposit1Payload = buildDepositLiquidityPayload(
    poolAddr,
    BigInt(params.amount1),
    BigInt(params.minLpAmount),
  );

  const msg1 = buildJettonTransferForDeposit(
    Address.parse(params.token1Address),
    senderAddr,
    BigInt(params.amount1),
    deposit1Payload,
  );

  const gasPerMsg = FORWARD_GAS_AMOUNT_NANOTONS + MIN_GAS_RESERVE_NANOTONS;
  const totalAmount = gasPerMsg * 2n;

  return {
    messages: [msg0, msg1],
    totalAmount: totalAmount.toString(),
    estimatedGas: (gasPerMsg * 2n).toString(),
    summary: `Add liquidity to DeDust pool: ${params.amount0} token0 + ${params.amount1} token1`,
  };
}

// ─── Native TON Swap ─────────────────────────────────────────

/**
 * Builds a native TON → Jetton swap via DeDust Native Vault.
 *
 * Message chain:
 * User → Native Vault (deposit TON + swap payload with recipientAddress)
 *   → Pool (execute swap)
 *   → Jetton Vault (release jettons)
 *   → Recipient (receive jettons at recipientAddress)
 */
function buildNativeTonSwap(params: SwapParams): TransactionPayload {
  const vaultAddr = Address.parse(DEDUST_NATIVE_VAULT_ADDR);
  const recipientAddr = Address.parse(params.recipientAddress);
  const senderAddr = Address.parse(params.senderAddress);

  const isForwarding = params.recipientAddress !== params.senderAddress;

  // Build swap step payload (inner)
  // This is the payload that gets forwarded from Vault → Pool
  const swapStepPayload = beginCell()
    .storeAddress(Address.parse(params.askAssetAddress)) // ask_asset pool
    .storeCoins(BigInt(params.minAskAmount))             // min_out
    .endCell();

  // Build the outer swap message to Native Vault
  const swapBody = beginCell()
    .storeUint(OP_NATIVE_DEPOSIT, 32)     // op: native_deposit
    .storeUint(0, 64)                      // query_id
    .storeUint(OP_DEDUST_SWAP, 32)        // inner_op: swap
    .storeCoins(BigInt(params.offerAmount)) // amount
    .storeAddress(recipientAddr)           // recipient (KEY: recipientAddress!)
    .storeBit(isForwarding)                // has_custom_recipient
    .storeRef(swapStepPayload)             // swap step params
    .endCell();

  const offerAmount = BigInt(params.offerAmount);
  const totalAmount = offerAmount + FORWARD_GAS_AMOUNT_NANOTONS;

  return {
    to: vaultAddr.toString(),
    amount: totalAmount.toString(),
    payload: swapBody.toBoc().toString('base64'),
    stateInit: null,
  };
}

// ─── Jetton Swap ─────────────────────────────────────────────

/**
 * Builds a Jetton → Jetton (or Jetton → TON) swap via DeDust.
 *
 * The recipientAddress is embedded in the swap forward_payload,
 * allowing the output tokens to be sent to a different address.
 */
function buildJettonSwap(params: SwapParams): TransactionPayload {
  const senderAddr = Address.parse(params.senderAddress);
  const recipientAddr = Address.parse(params.recipientAddress);
  const offerJettonAddr = Address.parse(params.offerAssetAddress);

  const isForwarding = params.recipientAddress !== params.senderAddress;

  // Swap step payload (forwarded through the chain)
  const swapStepPayload = beginCell()
    .storeAddress(Address.parse(params.askAssetAddress))
    .storeCoins(BigInt(params.minAskAmount))
    .endCell();

  // Swap instruction embedded in jetton transfer's forward_payload
  const swapForwardPayload = beginCell()
    .storeUint(OP_DEDUST_SWAP, 32)
    .storeUint(0, 64)
    .storeCoins(BigInt(params.offerAmount))
    .storeAddress(recipientAddr)           // ← recipientAddress
    .storeBit(isForwarding)                // has_custom_recipient flag
    .storeRef(swapStepPayload)
    .endCell();

  // Outer: standard jetton_transfer to the Vault
  const body = beginCell()
    .storeUint(OP_JETTON_TRANSFER, 32)
    .storeUint(0, 64)                      // query_id
    .storeCoins(BigInt(params.offerAmount))
    .storeAddress(Address.parse(DEDUST_FACTORY_ADDR)) // destination: factory vault
    .storeAddress(senderAddr)              // response_destination
    .storeBit(false)                       // no custom_payload
    .storeCoins(FORWARD_GAS_AMOUNT_NANOTONS)
    .storeBit(true)                        // forward_payload in ref
    .storeRef(swapForwardPayload)
    .endCell();

  const totalAmount = FORWARD_GAS_AMOUNT_NANOTONS + MIN_GAS_RESERVE_NANOTONS;

  return {
    to: offerJettonAddr.toString(), // Frontend resolves to jetton wallet
    amount: totalAmount.toString(),
    payload: body.toBoc().toString('base64'),
    stateInit: null,
  };
}

// ─── Deposit Liquidity ───────────────────────────────────────

function buildDepositLiquidityPayload(
  poolAddr: Address,
  amount: bigint,
  minLpOut: bigint,
): Cell {
  return beginCell()
    .storeUint(OP_DEDUST_DEPOSIT_LIQUIDITY, 32)
    .storeUint(0, 64)
    .storeAddress(poolAddr)
    .storeCoins(amount)
    .storeCoins(minLpOut)
    .endCell();
}

function buildJettonTransferForDeposit(
  jettonMasterAddr: Address,
  senderAddr: Address,
  amount: bigint,
  forwardPayload: Cell,
): TransactionPayload {
  const body = beginCell()
    .storeUint(OP_JETTON_TRANSFER, 32)
    .storeUint(0, 64)
    .storeCoins(amount)
    .storeAddress(Address.parse(DEDUST_FACTORY_ADDR))
    .storeAddress(senderAddr)
    .storeBit(false)
    .storeCoins(FORWARD_GAS_AMOUNT_NANOTONS)
    .storeBit(true)
    .storeRef(forwardPayload)
    .endCell();

  const totalAmount = FORWARD_GAS_AMOUNT_NANOTONS + MIN_GAS_RESERVE_NANOTONS;

  return {
    to: jettonMasterAddr.toString(),
    amount: totalAmount.toString(),
    payload: body.toBoc().toString('base64'),
    stateInit: null,
  };
}

// ─── Validation ──────────────────────────────────────────────

function validateSwapParams(params: SwapParams): void {
  if (params.maxSlippage > ABSOLUTE_MAX_SLIPPAGE) {
    throw new Error(
      `Slippage ${params.maxSlippage} exceeds absolute max ${ABSOLUTE_MAX_SLIPPAGE}`,
    );
  }

  if (BigInt(params.offerAmount) <= 0n) {
    throw new Error('Offer amount must be positive');
  }
  if (BigInt(params.minAskAmount) <= 0n) {
    throw new Error('Minimum ask amount must be positive');
  }

  // Validate all addresses
  Address.parse(params.senderAddress);
  Address.parse(params.recipientAddress);
  Address.parse(params.askAssetAddress);

  if (params.offerAssetAddress !== 'native') {
    Address.parse(params.offerAssetAddress);
  }

  // Log when recipientAddress differs (useful for debugging)
  if (params.recipientAddress !== params.senderAddress) {
    console.error(
      `[DeDust:TX] Custom recipientAddress: ${params.recipientAddress} ` +
      `(sender: ${params.senderAddress})`,
    );
  }
}

function validateLiquidityParams(params: AddLiquidityParams): void {
  if (BigInt(params.amount0) <= 0n || BigInt(params.amount1) <= 0n) {
    throw new Error('Both amounts must be positive');
  }

  Address.parse(params.poolAddress);
  Address.parse(params.senderAddress);
  Address.parse(params.token0Address);
  Address.parse(params.token1Address);
}
