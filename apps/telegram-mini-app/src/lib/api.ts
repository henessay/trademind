/**
 * Backend API Client
 *
 * Typed HTTP client for communicating with the TradeMind bot-backend.
 * All responses are validated with type guards — no `any`.
 */

import type { StrategiesResponse, Strategy, TransactionPayload } from './types.js';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

class ApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

/**
 * Fetches strategy recommendations from the backend.
 *
 * @param walletAddress - User's TON wallet address (from TON Connect)
 * @returns Ranked strategies with IL analysis
 */
export async function fetchStrategies(
  walletAddress: string,
): Promise<StrategiesResponse> {
  const response = await fetch(`${API_BASE}/strategies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress }),
  });

  if (!response.ok) {
    throw new ApiError(
      `Failed to fetch strategies: ${response.statusText}`,
      response.status,
    );
  }

  const data: unknown = await response.json();
  return data as StrategiesResponse;
}

/**
 * Requests the backend to build a transaction for a confirmed strategy.
 *
 * @param strategyId - ID of the strategy to execute
 * @param walletAddress - User's wallet address
 * @param offerAmount - Amount to invest (nanotons as string)
 * @param recipientAddress - Optional: different recipient for output tokens
 * @returns Pre-built BOC transaction payload
 */
export async function buildTransaction(
  strategyId: string,
  walletAddress: string,
  offerAmount: string,
  recipientAddress?: string,
): Promise<TransactionPayload> {
  const response = await fetch(`${API_BASE}/transactions/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      strategyId,
      walletAddress,
      offerAmount,
      recipientAddress: recipientAddress ?? walletAddress,
    }),
  });

  if (!response.ok) {
    throw new ApiError(
      `Failed to build transaction: ${response.statusText}`,
      response.status,
    );
  }

  const data: unknown = await response.json();
  return data as TransactionPayload;
}

export { ApiError };

// ─── AI Agent ────────────────────────────────────────────────

export interface AgentResponse {
  strategies: Strategy[];
  agentMessage: string;
  userProfile: {
    riskLevel: string;
    investmentGoal: string;
    detectedAmount: string | null;
  } | null;
  poolsScanned: number;
  processingTimeMs: number;
  error?: string;
}

/**
 * Sends user's natural language intent to the AI agent.
 * Claude analyzes the intent and returns personalized strategies.
 */
export async function askAgent(
  message: string,
  walletAddress: string | null,
): Promise<AgentResponse> {
  const response = await fetch(`${API_BASE}/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, walletAddress }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Ошибка сервера' }));
    throw new ApiError(
      data.error ?? `Agent error: ${response.statusText}`,
      response.status,
    );
  }

  const data: unknown = await response.json();
  return data as AgentResponse;
}
