/**
 * POST /api/strategies
 *
 * Returns ranked DeFi strategies for the connected wallet.
 * Currently serves curated demo data.
 * TODO: Wire to IntentEngine + MCP servers for live data.
 */

import { NextRequest, NextResponse } from 'next/server';

interface StrategyResponse {
  strategies: Strategy[];
  poolsScanned: number;
  poolsFiltered: number;
  processingTimeMs: number;
}

interface Strategy {
  id: string;
  name: string;
  type: string;
  protocol: string;
  poolAddress: string;
  pair: string;
  estimatedApyPercent: number;
  poolTvlUsd: number;
  volume24hUsd: number;
  ilRisk: {
    expectedIlPercent: number;
    worstCaseIlPercent: number;
    riskLevel: string;
    withinTolerance: boolean;
  };
  score: number;
  rationale: string;
  transactionPayload: null;
}

const STRATEGIES: Strategy[] = [
  {
    id: 'strat-usdt-usdc-dedust',
    name: 'Stable LP: USDT/USDC on DeDust',
    type: 'add_liquidity',
    protocol: 'dedust',
    poolAddress: 'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67',
    pair: 'USDT/USDC',
    estimatedApyPercent: 4.2,
    poolTvlUsd: 12_500_000,
    volume24hUsd: 3_200_000,
    ilRisk: {
      expectedIlPercent: 0.001,
      worstCaseIlPercent: 0.005,
      riskLevel: 'low',
      withinTolerance: true,
    },
    score: 92,
    rationale:
      'Пул стейблкойнов USDT/USDC на DeDust. TVL $12.5M, APY 4.2%. ' +
      'Риск непостоянных потерь минимальный — 0.5%. ' +
      'Идеально для консервативного инвестора. Оценка: 92/100.',
    transactionPayload: null,
  },
  {
    id: 'strat-ton-usdt-stonfi',
    name: 'Volatile LP: TON/USDT on STON.fi',
    type: 'add_liquidity',
    protocol: 'stonfi',
    poolAddress: 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt',
    pair: 'TON/USDT',
    estimatedApyPercent: 18.7,
    poolTvlUsd: 8_300_000,
    volume24hUsd: 5_100_000,
    ilRisk: {
      expectedIlPercent: 0.032,
      worstCaseIlPercent: 0.089,
      riskLevel: 'medium',
      withinTolerance: true,
    },
    score: 78,
    rationale:
      'Пул TON/USDT на STON.fi. TVL $8.3M, APY 18.7%. ' +
      'Ожидаемые непостоянные потери 3.2% (худший случай 8.9%). ' +
      'Подходит для умеренного риск-профиля. Оценка: 78/100.',
    transactionPayload: null,
  },
  {
    id: 'strat-ton-jusdt-dedust',
    name: 'Volatile LP: TON/jUSDT on DeDust',
    type: 'add_liquidity',
    protocol: 'dedust',
    poolAddress: 'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICQ_',
    pair: 'TON/jUSDT',
    estimatedApyPercent: 24.1,
    poolTvlUsd: 3_700_000,
    volume24hUsd: 1_900_000,
    ilRisk: {
      expectedIlPercent: 0.045,
      worstCaseIlPercent: 0.12,
      riskLevel: 'medium',
      withinTolerance: true,
    },
    score: 71,
    rationale:
      'Пул TON/jUSDT на DeDust. TVL $3.7M, APY 24.1%. ' +
      'Повышенная доходность при умеренном IL-риске (12%). ' +
      'Оценка: 71/100.',
    transactionPayload: null,
  },
];

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const walletAddress = body?.walletAddress;

    if (typeof walletAddress !== 'string' || walletAddress.length === 0) {
      return NextResponse.json(
        { error: 'walletAddress is required' },
        { status: 400 },
      );
    }

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    const response: StrategyResponse = {
      strategies: STRATEGIES,
      poolsScanned: 47,
      poolsFiltered: 3,
      processingTimeMs: 1240,
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
