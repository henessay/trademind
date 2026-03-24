/**
 * Frontend Types for TradeMind Telegram Mini App.
 *
 * Mirrors backend types from bot-backend/src/types/intent.ts.
 * Strict typing — no `any` per CLAUDE.md §5.
 */

// ─── Strategy ────────────────────────────────────────────────

export type StrategyType = 'swap' | 'add_liquidity' | 'stake';
export type DexProtocol = 'stonfi' | 'dedust';
export type RiskLevel = 'low' | 'medium' | 'high' | 'extreme';

export interface Strategy {
  readonly id: string;
  readonly name: string;
  readonly type: StrategyType;
  readonly protocol: DexProtocol;
  readonly poolAddress: string;
  readonly poolUrl: string | null;
  readonly pair: string;
  readonly estimatedApyPercent: number;
  readonly poolTvlUsd: number;
  readonly volume24hUsd: number;
  readonly ilRisk: IlRiskSummary;
  readonly score: number;
  readonly rationale: string;
  readonly transactionPayload: TransactionPayload | null;
}

export interface IlRiskSummary {
  readonly expectedIlPercent: number;
  readonly worstCaseIlPercent: number;
  readonly riskLevel: RiskLevel;
  readonly withinTolerance: boolean;
}

// ─── Transaction ─────────────────────────────────────────────

export interface TransactionPayload {
  readonly to: string;
  readonly amount: string;
  readonly payload: string;
  readonly stateInit: string | null;
}

export interface TransactionChain {
  readonly messages: readonly TransactionPayload[];
  readonly totalAmount: string;
  readonly estimatedGas: string;
  readonly summary: string;
}

// ─── API Response ────────────────────────────────────────────

export interface StrategiesResponse {
  readonly strategies: readonly Strategy[];
  readonly poolsScanned: number;
  readonly poolsFiltered: number;
  readonly processingTimeMs: number;
}

// ─── Transaction Status ──────────────────────────────────────

export type TransactionState =
  | { readonly status: 'idle' }
  | { readonly status: 'confirming'; readonly strategyId: string }
  | { readonly status: 'signing' }
  | { readonly status: 'success'; readonly txHash: string }
  | { readonly status: 'error'; readonly message: string };

// ─── Formatting Helpers ──────────────────────────────────────

export function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(2)}`;
}

export function formatProtocol(protocol: DexProtocol): string {
  return protocol === 'stonfi' ? 'STON.fi' : 'DeDust';
}

export function riskLevelColor(level: RiskLevel): string {
  switch (level) {
    case 'low': return 'var(--tg-theme-link-color, #2481cc)';
    case 'medium': return 'var(--tg-theme-accent-text-color, #e8a640)';
    case 'high': return 'var(--tg-theme-destructive-text-color, #e53935)';
    case 'extreme': return 'var(--tg-theme-destructive-text-color, #b71c1c)';
  }
}

export function riskLevelLabel(level: RiskLevel): string {
  switch (level) {
    case 'low': return 'Низкий';
    case 'medium': return 'Средний';
    case 'high': return 'Высокий';
    case 'extreme': return 'Критический';
  }
}
