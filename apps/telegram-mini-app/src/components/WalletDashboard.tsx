/**
 * WalletDashboard — Shows TON balance and token list.
 * Tap on token → "Хотите подобрать стратегию для {TOKEN}?"
 */

'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

interface TokenBalance {
  symbol: string;
  name: string;
  balanceFormatted: string;
  usdValue: number | null;
  jettonAddress: string;
  iconUrl: string | null;
}

interface WalletData {
  address: string;
  tonBalanceFormatted: string;
  tokens: TokenBalance[];
}

interface WalletDashboardProps {
  readonly address: string;
  readonly onSelectToken: (symbol: string) => void;
}

export function WalletDashboard({ address, onSelectToken }: WalletDashboardProps): ReactNode {
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const [selectedToken, setSelectedToken] = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/wallet/balance?address=${encodeURIComponent(address)}`);
      if (!res.ok) throw new Error(t('loadError'));
      const walletData: WalletData = await res.json();
      setData(walletData);
    } catch {
      setError(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { void fetchWallet(); }, [fetchWallet]);

  const handleConfirmStrategy = useCallback(() => {
    if (selectedToken !== null) {
      onSelectToken(selectedToken);
      setSelectedToken(null);
    }
  }, [selectedToken, onSelectToken]);

  if (loading) {
    return (
      <div className="text-center py-10 animate-fade-in">
        <div className="spinner mx-auto" />
        <p className="text-sm" style={{ color: 'var(--tg-theme-hint-color, #999)' }}>{t('loadingWallet')}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-10 animate-fade-in">
        <p className="text-sm text-status-danger mb-3">{error ?? t('error')}</p>
        <button className="btn-ghost max-w-[200px] mx-auto" onClick={fetchWallet}>{t('retry')}</button>
      </div>
    );
  }

  // Build full token list: TON first, then jettons
  const allTokens = [
    { symbol: 'TON', name: 'Toncoin', balanceFormatted: data.tonBalanceFormatted, iconUrl: null as string | null, isTon: true },
    ...data.tokens.map((t) => ({ ...t, isTon: false })),
  ];

  return (
    <div className="animate-fade-in">
      {/* Balance card */}
      <div className="bg-surface-section rounded-tg p-5 mb-5 text-center">
        <p className="text-xs font-sans uppercase tracking-wider mb-2" style={{ color: 'var(--tg-theme-hint-color, #999)' }}>
          {t('walletBalance')}
        </p>
        <div className="flex items-baseline justify-center gap-2">
          <span className="font-mono text-3xl font-bold" style={{ color: 'var(--tg-theme-text-color, #0F1011)' }}>
            {data.tonBalanceFormatted}
          </span>
          <span className="font-mono text-lg font-medium" style={{ color: 'var(--tg-theme-subtitle-text-color, #8E8E93)' }}>
            TON
          </span>
        </div>
      </div>

      {/* Token list */}
      <h3 className="section-label mb-3">{t('yourAssets')}</h3>
      <div className="bg-surface-section rounded-tg overflow-hidden mb-4">
        {allTokens.map((token, i) => (
          <button
            key={token.symbol + i}
            onClick={() => setSelectedToken(token.symbol)}
            className="w-full flex items-center gap-3 px-4 py-3.5 bg-transparent border-none cursor-pointer outline-none transition-colors duration-150 hover:bg-surface-secondary active:bg-surface-secondary text-left"
            style={{ borderTop: i > 0 ? '1px solid #f3f4f6' : 'none' }}
          >
            {/* Icon */}
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 overflow-hidden" style={{ background: token.isTon ? 'rgba(77,184,255,0.12)' : '#F7F8FA' }}>
              {token.isTon ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 8.5L12 22L22 8.5L12 2Z" fill="#4DB8FF" fillOpacity="0.7" />
                  <path d="M12 2L2 8.5H22L12 2Z" fill="#4DB8FF" />
                </svg>
              ) : token.iconUrl ? (
                <img src={token.iconUrl} alt={token.symbol} width={36} height={36} className="w-9 h-9 rounded-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <span className="text-xs font-sans font-bold" style={{ color: 'var(--tg-theme-subtitle-text-color, #8E8E93)' }}>{token.symbol.slice(0, 2)}</span>
              )}
            </div>
            {/* Name */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-sans font-semibold" style={{ color: 'var(--tg-theme-text-color, #0F1011)' }}>{token.symbol}</p>
              <p className="text-xs font-sans truncate" style={{ color: 'var(--tg-theme-hint-color, #999)' }}>{token.name}</p>
            </div>
            {/* Balance */}
            <p className="text-sm font-mono font-medium shrink-0" style={{ color: 'var(--tg-theme-text-color, #0F1011)' }}>
              {token.balanceFormatted}
            </p>
            {/* Arrow */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M6 4L10 8L6 12" stroke="var(--tg-theme-hint-color, #C7C7CC)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>

      {/* Refresh */}
      <button onClick={fetchWallet} className="w-full py-2 text-xs font-sans bg-transparent border-none cursor-pointer outline-none" style={{ color: 'var(--tg-theme-hint-color, #999)' }}>
        {t('refreshBalance')}
      </button>

      {/* ── Bottom Sheet: "{t('findStrategy')}?" ── */}
      {selectedToken !== null && (
        <>
          <div className="fixed inset-0 z-40 bg-black bg-opacity-30 animate-fade-in" onClick={() => setSelectedToken(null)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface-primary rounded-t-[20px] px-6 pt-6 pb-8 animate-slide-up" style={{ boxShadow: '0 -4px 20px rgba(0,0,0,0.08)' }}>
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5" />
            <p className="text-lg font-sans font-bold text-center mb-2" style={{ color: 'var(--tg-theme-text-color, #0F1011)' }}>{selectedToken}</p>
            <p className="text-sm font-sans text-center mb-6" style={{ color: 'var(--tg-theme-subtitle-text-color, #8E8E93)' }}>
              {t('wantStrategy')} {selectedToken}?
            </p>
            <button className="btn-primary mb-3" onClick={handleConfirmStrategy}>
              {t('findStrategy')}
            </button>
            <button className="w-full py-3 rounded-tg-sm text-sm font-sans font-medium bg-transparent border-none cursor-pointer outline-none" style={{ color: 'var(--tg-theme-subtitle-text-color, #8E8E93)' }} onClick={() => setSelectedToken(null)}>
              {t('cancel')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
