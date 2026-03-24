/**
 * Storage Guarantee Smart Contract Module
 *
 * Manages the lifecycle of TON Storage guarantee contracts that ensure
 * the persistence of encrypted user profiles in the decentralized network.
 *
 * How it works:
 * 1. After uploading a Bag to TON Storage, we deploy a storage guarantee contract
 * 2. The contract locks Toncoin as payment to storage providers
 * 3. Providers periodically submit Merkle proofs to the contract
 * 4. If a provider fails to prove data availability, they lose their deposit
 * 5. This mechanism guarantees data persistence for the paid duration
 *
 * Architecture note: This module builds the contract deployment message as a BOC
 * (Bag of Cells). The actual signing happens on the client side via TON Connect.
 * The backend NEVER has access to private keys (see CLAUDE.md §7).
 *
 * References:
 * - TON Storage: https://ton.org/en/ton-storage
 * - Storage contract: deployed by the network, our module interacts with it
 */

import {
  Address,
  beginCell,
  toNano,
  type Cell,
  type StateInit,
} from '@ton/core';
import type { StorageContractConfig } from '../types/profile.js';

// ─── Constants ───────────────────────────────────────────────

/** Minimum storage guarantee period: 30 days in seconds */
const MIN_GUARANTEE_PERIOD_SEC = 30 * 24 * 60 * 60;

/** Default storage guarantee period: 365 days in seconds */
const DEFAULT_GUARANTEE_PERIOD_SEC = 365 * 24 * 60 * 60;

/** Maximum storage guarantee period: 5 years in seconds */
const MAX_GUARANTEE_PERIOD_SEC = 5 * 365 * 24 * 60 * 60;

/**
 * Base storage cost per kilobyte per year in nanotons.
 * This is an estimate — actual cost depends on network conditions.
 * The deployer should add a safety margin (~20%).
 */
const BASE_COST_PER_KB_PER_YEAR_NANOTONS = 50_000_000n; // ~0.05 TON per KB/year

/** Minimum Toncoin amount for contract deployment (covers gas + rent) */
const MIN_DEPLOYMENT_NANOTONS = toNano('0.5');

/** Op-code for the storage contract's "top up" operation */
const OP_TOP_UP = 0x0001;

/** Op-code for the storage contract's "close" (withdraw remaining) operation */
const OP_CLOSE = 0x0002;

// ─── Types ───────────────────────────────────────────────────

/** Parameters for deploying a new storage guarantee contract */
export interface DeployStorageContractParams {
  /** Bag ID of the uploaded encrypted profile */
  readonly bagId: string;

  /** Size of the encrypted payload in bytes */
  readonly payloadSizeBytes: number;

  /** Storage guarantee period in seconds (default: 1 year) */
  readonly guaranteePeriodSec?: number;

  /** Wallet address of the contract owner (the user) */
  readonly ownerAddress: string;

  /** Wallet address of the storage provider node */
  readonly providerAddress: string;
}

/**
 * A pre-built transaction payload ready for TON Connect signing.
 * The backend generates this; the client signs it via tonConnectUI.sendTransaction.
 */
export interface StorageContractTransaction {
  /** Target address (the contract or deployer) */
  readonly to: string;

  /** Amount of Toncoin to send (in nanotons, as string for JSON safety) */
  readonly amount: string;

  /** BOC-encoded message body (base64) */
  readonly payload: string;

  /** State init for contract deployment (base64, only for first deploy) */
  readonly stateInit: string | null;
}

// ─── Contract Builder ────────────────────────────────────────

/**
 * Builds the deployment transaction for a TON Storage guarantee contract.
 *
 * This creates a BOC that, when signed by the user via TON Connect, will:
 * 1. Deploy the storage contract on-chain
 * 2. Lock the calculated Toncoin amount for the guarantee period
 * 3. Register the Bag ID and provider address in the contract state
 *
 * @param params - Contract deployment parameters
 * @returns Pre-built transaction for TON Connect signing
 *
 * @throws Error if parameters are invalid (bad address, period out of range, etc.)
 */
export function buildStorageContractDeployment(
  params: DeployStorageContractParams,
): StorageContractTransaction {
  // ── Validate inputs ──
  const guaranteePeriod = params.guaranteePeriodSec ?? DEFAULT_GUARANTEE_PERIOD_SEC;

  validateGuaranteePeriod(guaranteePeriod);
  validateBagId(params.bagId);

  const ownerAddr = parseAddress(params.ownerAddress, 'ownerAddress');
  const providerAddr = parseAddress(params.providerAddress, 'providerAddress');

  // ── Calculate storage cost ──
  const paymentNanotons = calculateStorageCost(
    params.payloadSizeBytes,
    guaranteePeriod,
  );

  // ── Build contract data cell (initial state) ──
  const dataCell = buildContractDataCell({
    bagIdHex: params.bagId,
    ownerAddress: ownerAddr,
    providerAddress: providerAddr,
    guaranteePeriodSec: guaranteePeriod,
    createdAt: Math.floor(Date.now() / 1000),
  });

  // ── Build contract code cell (placeholder for actual contract code) ──
  const codeCell = buildStorageContractCode();

  // ── Assemble StateInit ──
  const stateInit: StateInit = {
    code: codeCell,
    data: dataCell,
  };

  const stateInitCell = beginCell()
    .storeBit(false)      // split_depth: none
    .storeBit(false)      // special: none
    .storeMaybeRef(stateInit.code)
    .storeMaybeRef(stateInit.data)
    .storeBit(false)      // libraries: none
    .endCell();

  // ── Build the deployment message body ──
  const messageBody = beginCell()
    .storeUint(OP_TOP_UP, 32)   // op code
    .storeUint(0, 64)            // query_id
    .endCell();

  // ── Calculate contract address (hash of StateInit) ──
  const contractAddress = computeContractAddress(stateInitCell);

  return {
    to: contractAddress.toString(),
    amount: paymentNanotons.toString(),
    payload: messageBody.toBoc().toString('base64'),
    stateInit: stateInitCell.toBoc().toString('base64'),
  };
}

/**
 * Builds a top-up transaction to extend the storage guarantee period.
 *
 * @param contractAddress - Existing storage contract address
 * @param additionalNanotons - Additional Toncoin to add
 * @returns Pre-built transaction for TON Connect signing
 */
export function buildStorageTopUp(
  contractAddress: string,
  additionalNanotons: bigint,
): StorageContractTransaction {
  if (additionalNanotons <= 0n) {
    throw new Error('Top-up amount must be positive');
  }

  const messageBody = beginCell()
    .storeUint(OP_TOP_UP, 32)
    .storeUint(0, 64)
    .endCell();

  return {
    to: contractAddress,
    amount: additionalNanotons.toString(),
    payload: messageBody.toBoc().toString('base64'),
    stateInit: null,
  };
}

/**
 * Builds a close transaction to withdraw remaining funds from a storage contract.
 * Only the contract owner can execute this.
 *
 * @param contractAddress - Storage contract to close
 * @returns Pre-built transaction for TON Connect signing
 */
export function buildStorageClose(
  contractAddress: string,
): StorageContractTransaction {
  const messageBody = beginCell()
    .storeUint(OP_CLOSE, 32)
    .storeUint(0, 64)
    .endCell();

  return {
    to: contractAddress,
    amount: toNano('0.05').toString(), // Gas for execution
    payload: messageBody.toBoc().toString('base64'),
    stateInit: null,
  };
}

/**
 * Calculates the estimated storage cost based on payload size and duration.
 * Adds a 20% safety margin for network fee fluctuations.
 */
export function calculateStorageCost(
  payloadSizeBytes: number,
  guaranteePeriodSec: number,
): bigint {
  const sizeKb = Math.ceil(payloadSizeBytes / 1024);
  const years = guaranteePeriodSec / (365 * 24 * 60 * 60);

  const baseCost = BigInt(sizeKb) *
    BASE_COST_PER_KB_PER_YEAR_NANOTONS *
    BigInt(Math.ceil(years));

  // Add 20% safety margin
  const withMargin = baseCost + (baseCost * 20n) / 100n;

  // Ensure minimum deployment cost is covered
  return withMargin < MIN_DEPLOYMENT_NANOTONS
    ? MIN_DEPLOYMENT_NANOTONS
    : withMargin;
}

/**
 * Extracts storage contract configuration from an on-chain contract state.
 * Used by the Universal Resolver to verify profile storage status.
 */
export function parseStorageContractState(
  contractAddress: string,
  dataCell: Cell,
): StorageContractConfig {
  const slice = dataCell.beginParse();

  const bagIdBits = slice.loadBuffer(32);
  const bagId = bagIdBits.toString('hex');

  const guaranteePeriodSec = slice.loadUint(32);
  const paymentNanotons = slice.loadCoins();

  return {
    contractAddress,
    bagId,
    guaranteePeriodSec,
    paymentNanotons,
  };
}

// ─── Internal Helpers ────────────────────────────────────────

interface ContractDataParams {
  readonly bagIdHex: string;
  readonly ownerAddress: Address;
  readonly providerAddress: Address;
  readonly guaranteePeriodSec: number;
  readonly createdAt: number;
}

function buildContractDataCell(params: ContractDataParams): Cell {
  const bagIdBuffer = Buffer.from(params.bagIdHex, 'hex');

  return beginCell()
    .storeBuffer(bagIdBuffer)                  // 32 bytes: Bag ID
    .storeAddress(params.ownerAddress)         // owner
    .storeAddress(params.providerAddress)      // provider
    .storeUint(params.guaranteePeriodSec, 32)  // guarantee period
    .storeUint(params.createdAt, 32)           // creation timestamp
    .storeCoins(0)                              // withdrawn amount (initially 0)
    .endCell();
}

/**
 * Placeholder for the actual storage guarantee contract code.
 *
 * In production, this would be the compiled FunC/Tact contract bytecode.
 * The contract implements:
 * - accept_storage_proof: validate Merkle proofs from providers
 * - top_up: add more Toncoin to extend guarantee
 * - close: owner withdraws remaining funds
 * - get_bag_id: getter for the stored Bag ID
 *
 * TODO: Replace with actual compiled contract BOC when FunC code is ready.
 */
function buildStorageContractCode(): Cell {
  // Minimal contract code placeholder
  // In production, load from a pre-compiled .boc file
  return beginCell()
    .storeUint(0xff00, 16) // magic bytes indicating placeholder
    .endCell();
}

function computeContractAddress(stateInitCell: Cell): Address {
  // Workchain 0 (basechain) for storage contracts
  return new Address(0, stateInitCell.hash());
}

function parseAddress(raw: string, fieldName: string): Address {
  try {
    return Address.parse(raw);
  } catch {
    throw new Error(
      `Invalid TON address for ${fieldName}: "${raw}". ` +
      'Expected a valid TON address in any format (raw, bounceable, non-bounceable).',
    );
  }
}

function validateGuaranteePeriod(seconds: number): void {
  if (seconds < MIN_GUARANTEE_PERIOD_SEC) {
    throw new Error(
      `Guarantee period too short: ${seconds}s. ` +
      `Minimum is ${MIN_GUARANTEE_PERIOD_SEC}s (30 days).`,
    );
  }
  if (seconds > MAX_GUARANTEE_PERIOD_SEC) {
    throw new Error(
      `Guarantee period too long: ${seconds}s. ` +
      `Maximum is ${MAX_GUARANTEE_PERIOD_SEC}s (5 years).`,
    );
  }
}

function validateBagId(bagId: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(bagId)) {
    throw new Error(
      `Invalid Bag ID: "${bagId}". Expected 64 hex characters (256-bit hash).`,
    );
  }
}
