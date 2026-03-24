/**
 * POST /api/transactions/build
 *
 * Builds a transaction payload (BOC) for a confirmed strategy.
 * Returns the data needed for tonConnectUI.sendTransaction().
 *
 * For demo: builds a 0.01 TON transfer to the pool address.
 * For production: will use IntentEngine's buildTransactionPayload.
 */

import { NextRequest, NextResponse } from 'next/server';

interface BuildRequest {
  strategyId: string;
  walletAddress: string;
  offerAmount: string;
  recipientAddress?: string;
}

interface TransactionPayload {
  to: string;
  amount: string;
  payload: string;
  stateInit: string | null;
}

// Pool addresses — covers all agent pool IDs
const STRATEGY_POOLS: Record<string, string> = {
  'pool-usdt-usdc-dedust': 'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67',
  'pool-ton-usdt-stonfi': 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt',
  'pool-ton-jusdt-dedust': 'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICQ_',
  'pool-ton-usdc-stonfi': 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt',
  'pool-ton-ston-stonfi': 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt',
  'pool-usdt-dai-dedust': 'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICQ_',
  'pool-ton-not-stonfi': 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt',
  'pool-not-usdt-dedust': 'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICQ_',
  'pool-dogs-ton-stonfi': 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt',
  'pool-cati-ton-stonfi': 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt',
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: BuildRequest = await request.json();

    if (!body.strategyId || !body.walletAddress) {
      return NextResponse.json(
        { error: 'strategyId and walletAddress are required' },
        { status: 400 },
      );
    }

    const poolAddress = STRATEGY_POOLS[body.strategyId];
    if (!poolAddress) {
      return NextResponse.json(
        { error: `Unknown strategy: ${body.strategyId}` },
        { status: 404 },
      );
    }

    // Build a simple TON transfer transaction
    // Amount: 0.01 TON = 10_000_000 nanotons (safe demo amount)
    const amount = body.offerAmount || '10000000';

    const payload: TransactionPayload = {
      to: poolAddress,
      amount,
      payload: '', // Empty payload = simple transfer
      stateInit: null,
    };

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: 'Failed to build transaction' },
      { status: 500 },
    );
  }
}
