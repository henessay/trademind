/**
 * IntentEngine Configuration
 *
 * Centralized constants and risk-aligned defaults.
 * These thresholds determine which pools are considered "safe" for each
 * risk level from Identity Hub's RiskProfile.
 */

// ─── Risk-Based Pool Filters ─────────────────────────────────

/** Minimum TVL (USD) by risk level — lower TVL = higher risk of rug pull */
export const MIN_TVL_BY_RISK = {
  conservative: 500_000,
  moderate: 100_000,
  aggressive: 10_000,
} as const;

/** Maximum acceptable IL (95th percentile) by risk level */
export const MAX_IL_BY_RISK = {
  conservative: 0.03,   // 3%
  moderate: 0.10,        // 10%
  aggressive: 0.25,      // 25%
} as const;

/** Preferred pool types by risk level */
export const PREFERRED_POOL_TYPES = {
  conservative: ['stable'] as readonly string[],
  moderate: ['stable', 'volatile'] as readonly string[],
  aggressive: ['volatile', 'stable'] as readonly string[],
} as const;

// ─── Transaction Safety Limits ───────────────────────────────

/** Maximum slippage tolerance for swap transactions */
export const MAX_SLIPPAGE = {
  conservative: 0.005,   // 0.5%
  moderate: 0.01,         // 1%
  aggressive: 0.03,       // 3%
} as const;

/** Absolute slippage ceiling — never exceeded regardless of risk level */
export const ABSOLUTE_MAX_SLIPPAGE = 0.05; // 5%

/** Minimum amount of TON to keep for gas fees (in nanotons) */
export const MIN_GAS_RESERVE_NANOTONS = 500_000_000n; // 0.5 TON

/** Forward gas amount for jetton transfers (in nanotons) */
export const FORWARD_GAS_AMOUNT_NANOTONS = 300_000_000n; // 0.3 TON

// ─── MCP Tool Timeouts ───────────────────────────────────────

/** Timeout for pool discovery calls (ms) */
export const POOL_DISCOVERY_TIMEOUT_MS = 15_000;

/** Timeout for quote requests (ms) */
export const QUOTE_TIMEOUT_MS = 10_000;

/** Timeout for IL analysis (ms) */
export const IL_ANALYSIS_TIMEOUT_MS = 20_000;

// ─── Strategy Ranking ────────────────────────────────────────

/** Maximum number of strategies to present to the user */
export const MAX_STRATEGIES = 5;

/** Weight factors for strategy scoring */
export const SCORE_WEIGHTS = {
  /** Higher APY = better score */
  apyWeight: 0.35,
  /** Lower IL risk = better score */
  ilSafetyWeight: 0.30,
  /** Higher TVL = better score (more stable pool) */
  tvlWeight: 0.20,
  /** Higher volume = better score (more liquid) */
  volumeWeight: 0.15,
} as const;

// ─── DeDust Specific ─────────────────────────────────────────

/** DeDust V2 Factory address on mainnet */
export const DEDUST_FACTORY_ADDR =
  'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67';

/** DeDust V2 Vault (native TON) address */
export const DEDUST_NATIVE_VAULT_ADDR =
  'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICQ_';

// ─── STON.fi Specific ────────────────────────────────────────

/** STON.fi Router V2 address on mainnet */
export const STONFI_ROUTER_ADDR =
  'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt';

/** Referral address for STON.fi fee routing (TradeMind platform wallet) */
export const TRADEMIND_REFERRAL_ADDR =
  'EQC_TRADEMIND_PLATFORM_FEE_WALLET_PLACEHOLDER___';
