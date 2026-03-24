/**
 * WalletConnect — Custom wallet connection button + connected state.
 *
 * Uses a custom button instead of <TonConnectButton /> to control:
 * - Font: ABC Diatype (font-sans) instead of TonConnect's default
 * - Color: TON Blue (#4DB8FF) background with white text
 * - Border radius: 12px (rounded-tg-sm) matching app design
 * - Connected state: shows truncated address (font-mono) with disconnect
 *
 * Calls tonConnectUI.openModal() for wallet selection and
 * tonConnectUI.disconnect() for disconnecting.
 *
 * The modal window appearance is controlled via uiPreferences on the
 * TonConnectUIProvider (see AppContent.tsx).
 */

'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import {
  useTonConnectUI,
  useTonWallet,
  useTonAddress,
} from '@tonconnect/ui-react';

export function WalletConnect(): ReactNode {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const rawAddress = useTonAddress(false);
  const friendlyAddress = useTonAddress(true);
  const [showMenu, setShowMenu] = useState(false);
  const { t } = useI18n();

  const connected = wallet !== null;
  const walletName = wallet?.device?.appName ?? null;

  const handleConnect = useCallback(() => {
    void tonConnectUI.openModal();
  }, [tonConnectUI]);

  const handleDisconnect = useCallback(() => {
    void tonConnectUI.disconnect();
    setShowMenu(false);
  }, [tonConnectUI]);

  // ── Disconnected: show connect button ──

  if (!connected) {
    return (
      <button
        onClick={handleConnect}
        className="
          w-full flex items-center justify-center gap-2.5
          py-3.5 px-6 rounded-tg-sm
          font-sans text-[15px] font-semibold
          text-white cursor-pointer
          transition-all duration-150 ease-out
          active:scale-[0.98] active:opacity-85
          border-none outline-none
        "
        style={{ background: '#4DB8FF' }}
      >
        {/* TON diamond icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L2 8.5L12 22L22 8.5L12 2Z"
            fill="white"
            fillOpacity="0.9"
          />
          <path
            d="M12 2L2 8.5H22L12 2Z"
            fill="white"
          />
        </svg>
        {t('connectWallet')}
      </button>
    );
  }

  // ── Connected: show address + wallet info ──

  const shortAddr = friendlyAddress
    ? `${friendlyAddress.slice(0, 4)}...${friendlyAddress.slice(-4)}`
    : rawAddress
      ? `${rawAddress.slice(0, 4)}...${rawAddress.slice(-4)}`
      : '';

  return (
    <div className="relative">
      {/* Connected pill button */}
      <button
        onClick={() => setShowMenu((prev) => !prev)}
        className="
          w-full flex items-center justify-between
          py-3 px-4 rounded-tg-sm
          bg-surface-section
          cursor-pointer
          transition-all duration-150 ease-out
          active:scale-[0.99]
          outline-none
        "
        style={{ border: '1px solid var(--tg-theme-secondary-bg-color, #F3F4F6)' }}
      >
        <div className="flex items-center gap-3">
          {/* Green dot — connected indicator */}
          <div className="w-2.5 h-2.5 rounded-full bg-status-success shrink-0" />
          <div className="text-left">
            <p className="font-mono text-sm font-medium text-text-primary leading-tight">
              {shortAddr}
            </p>
            {walletName !== null && (
              <p className="font-sans text-[11px] text-text-hint mt-0.5">
                {walletName}
              </p>
            )}
          </div>
        </div>
        {/* Chevron */}
        <svg
          width="16" height="16" viewBox="0 0 16 16" fill="none"
          className={`
            text-text-hint transition-transform duration-200
            ${showMenu ? 'rotate-180' : ''}
          `}
        >
          <path
            d="M4 6L8 10L12 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Dropdown menu */}
      {showMenu && (
        <div
          className="
            absolute top-full left-0 right-0 mt-2 z-10
            bg-surface-section rounded-tg-sm
            overflow-hidden animate-fade-in
          "
          style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
        >
          {/* Full address */}
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--tg-theme-secondary-bg-color, #F3F4F6)' }}>
            <p className="text-[11px] font-sans text-text-hint uppercase tracking-wider mb-1">
              {t('address')}
            </p>
            <p className="font-mono text-xs text-text-primary break-all leading-relaxed">
              {friendlyAddress || rawAddress}
            </p>
          </div>

          {/* Disconnect button */}
          <button
            onClick={handleDisconnect}
            className="
              w-full px-4 py-3
              text-left text-sm font-sans font-medium
              text-status-danger
              bg-transparent border-none cursor-pointer
              transition-colors duration-150
              hover:bg-status-danger-soft
              outline-none
            "
          >
            {t('disconnectWallet')}
          </button>
        </div>
      )}

      {/* Overlay to close menu */}
      {showMenu && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowMenu(false)}
        />
      )}
    </div>
  );
}
