/**
 * IntentEngine Types
 *
 * Strict types for the intent execution pipeline:
 * User Intent → Pool Discovery → Strategy Ranking → BOC Generation
 *
 * No `any` — see CLAUDE.md §5.
 */

// ─── Risk Profile (re-exported from identity-hub) ────────────

export type RiskLevel = 'conservative' | 'moderate' | 'aggressive';
export type TimeHorizon = 'short' | 'medium' | 'long';

export interface RiskProfile {
  readonly riskLevel: RiskLevel;
  readonly timeHorizon: TimeHorizon;
  readonly preferredAssets: readonly string[];
  readonly maxDrawdown: number;
}

export interface UserProfile {
  readonly walletAddress: string;
  readonly riskProfile: RiskProfile;
  readonly bagId: string | null;
  readonly storageContractAddress: string | null;
  readonly updatedAt: string;
  readonly schemaVersion: number;
}

// ─── Strategy ────────────────────────────────────────────────

export type StrategyType = 'swap' | 'add_liquidity' | 'stake';
export type DexProtocol = 'stonfi' | 'dedust';

export interface Strategy {
  /** Unique ID for this strategy */
  readonly id: string;

  /** Human-readable strategy name */
  readonly name: string;

  /** Strategy type */
  readonly type: StrategyType;

  /** Which DEX protocol this strategy uses */
  readonly protocol: DexProtocol;

  /** Pool address on TON */
  readonly poolAddress: string;

  /** Token pair display name (e.g., 'TON/USDT') */
  readonly pair: string;

  /** Estimated annual percentage yield */
  readonly estimatedApyPercent: number;

  /** Total value locked in the pool (USD) */
  readonly poolTvlUsd: number;

  /** 24h volume (USD) */
  readonly volume24hUsd: number;

  /** Impermanent loss risk assessment */
  readonly ilRisk: IlRiskSummary;

  /** Composite score (0-100) — higher is better */
  readonly score: number;

  /** AI-generated text explanation of why this strategy was selected */
  readonly rationale: string;

  /** Pre-built transaction payload (null until user requests execution) */
  readonly transactionPayload: TransactionPayload | null;
}

export interface IlRiskSummary {
  /** Expected IL percent over the user's time horizon */
  readonly expectedIlPercent: number;

  /** 95th percentile worst-case IL */
  readonly worstCaseIlPercent: number;

  /** Risk classification */
  readonly riskLevel: 'low' | 'medium' | 'high' | 'extreme';

  /** Whether this passes the user's risk tolerance */
  readonly withinTolerance: boolean;
}

// ─── Transaction Payload (BOC) ───────────────────────────────

export interface TransactionPayload {
  /** Target contract address */
  readonly to: string;

  /** Amount of TON to send (nanotons as string for JSON safety) */
  readonly amount: string;

  /** BOC-encoded message body (base64) */
  readonly payload: string;

  /** State init for contract deployment (base64, null if not deploying) */
  readonly stateInit: string | null;
}

/** A strategy may require a chain of sequential messages */
export interface TransactionChain {
  /** Ordered list of transactions to be signed and sent */
  readonly messages: readonly TransactionPayload[];

  /** Total TON required across all messages (nanotons as string) */
  readonly totalAmount: string;

  /** Estimated gas cost (nanotons as string) */
  readonly estimatedGas: string;

  /** Human-readable summary */
  readonly summary: string;
}

// ─── Swap Parameters ─────────────────────────────────────────

export interface SwapParams {
  /** Source token address (jetton master or 'native' for TON) */
  readonly offerAssetAddress: string;

  /** Destination token address */
  readonly askAssetAddress: string;

  /** Amount to swap (in minimal units, as string) */
  readonly offerAmount: string;

  /** Minimum amount to receive (after slippage, in minimal units) */
  readonly minAskAmount: string;

  /** Sender's wallet address */
  readonly senderAddress: string;

  /**
   * Recipient address for the output tokens.
   * If different from senderAddress, the tokens go to this address.
   * Critical for DeDust: swapParams.recipientAddress
   */
  readonly recipientAddress: string;

  /** Maximum slippage as decimal (e.g., 0.01 = 1%) */
  readonly maxSlippage: number;

  /** Referral address for fee routing (TradeMind platform) */
  readonly referralAddress: string | null;
}

export interface AddLiquidityParams {
  /** Pool address */
  readonly poolAddress: string;

  /** Token 0 address */
  readonly token0Address: string;

  /** Token 1 address */
  readonly token1Address: string;

  /** Amount of token 0 (minimal units, as string) */
  readonly amount0: string;

  /** Amount of token 1 (minimal units, as string) */
  readonly amount1: string;

  /** Minimum LP tokens to receive */
  readonly minLpAmount: string;

  /** Sender's wallet address */
  readonly senderAddress: string;
}

// ─── MCP Tool Results (normalized) ───────────────────────────

export interface NormalizedPool {
  readonly address: string;
  readonly protocol: DexProtocol;
  readonly poolType: 'volatile' | 'stable';
  readonly token0Symbol: string;
  readonly token0Address: string;
  readonly token0Decimals: number;
  readonly token1Symbol: string;
  readonly token1Address: string;
  readonly token1Decimals: number;
  readonly tvlUsd: number;
  readonly apyPercent: number;
  readonly volume24hUsd: number;
  readonly fees24hUsd: number;
}

// ─── IntentEngine Interface ──────────────────────────────────

export interface IntentEngineResult {
  /** Ranked strategies (best first) */
  readonly strategies: readonly Strategy[];

  /** Total pools scanned across both DEXes */
  readonly poolsScanned: number;

  /** Pools that passed risk filters */
  readonly poolsFiltered: number;

  /** Processing time in milliseconds */
  readonly processingTimeMs: number;
}

// ─── MCP Client Interface (Dependency Injection) ─────────────

export interface McpToolClient {
  /** Call a tool on the STON.fi MCP server */
  callStonfiTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<McpToolResponse>;

  /** Call a tool on the DeDust MCP server */
  callDedustTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<McpToolResponse>;
}

export interface McpToolResponse {
  readonly content: readonly McpTextContent[];
  readonly isError?: boolean;
}

export interface McpTextContent {
  readonly type: 'text';
  readonly text: string;
}
