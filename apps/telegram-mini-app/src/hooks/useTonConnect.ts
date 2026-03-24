/**
 * useTonConnect Hook — simple wrapper over @tonconnect/ui-react.
 * Only used inside components that are dynamically imported (no SSR).
 */

'use client';

import { useCallback } from 'react';
import {
  useTonConnectUI,
  useTonWallet,
  useTonAddress,
} from '@tonconnect/ui-react';
import type { TransactionPayload } from '../lib/types';

interface TonConnectState {
  readonly connected: boolean;
  readonly address: string | null;
  readonly shortAddress: string | null;
  readonly walletName: string | null;
  readonly sendTransaction: (payload: TransactionPayload) => Promise<string>;
  readonly disconnect: () => Promise<void>;
}

export function useTonConnect(): TonConnectState {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const rawAddress = useTonAddress(false);

  const connected = wallet !== null;
  const address = connected ? rawAddress : null;
  const shortAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : null;
  const walletName = wallet?.device?.appName ?? null;

  const sendTransaction = useCallback(
    async (payload: TransactionPayload): Promise<string> => {
      if (!connected) throw new Error('Wallet not connected');
      const result = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{
          address: payload.to,
          amount: payload.amount,
          payload: payload.payload,
          stateInit: payload.stateInit ?? undefined,
        }],
      });
      return result.boc;
    },
    [tonConnectUI, connected],
  );

  const disconnect = useCallback(async () => {
    await tonConnectUI.disconnect();
  }, [tonConnectUI]);

  return { connected, address, shortAddress, walletName, sendTransaction, disconnect };
}
