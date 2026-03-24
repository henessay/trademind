/**
 * WalletButton — TON Connect wallet connection button.
 *
 * Uses @tonconnect/ui-react's TonConnectButton for native
 * wallet discovery (Tonkeeper, Telegram Wallet, OpenMask, etc.)
 */

'use client';

import { TonConnectButton } from '@tonconnect/ui-react';
import type { ReactNode } from 'react';

interface WalletButtonProps {
  /** Connected wallet short address (e.g., 'EQBf...p4q2') */
  readonly shortAddress: string | null;

  /** Name of the connected wallet app */
  readonly walletName: string | null;

  /** Whether a wallet is connected */
  readonly connected: boolean;
}

export function WalletButton({
  shortAddress,
  walletName,
  connected,
}: WalletButtonProps): ReactNode {
  return (
    <div style={{ padding: '8px 0' }}>
      <TonConnectButton />
      {connected && shortAddress !== null && (
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color: 'var(--tg-theme-hint-color)',
            textAlign: 'center',
          }}
        >
          {walletName !== null ? `${walletName}: ` : ''}
          {shortAddress}
        </div>
      )}
    </div>
  );
}
