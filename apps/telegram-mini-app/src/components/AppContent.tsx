/**
 * AppContent — TradeMind Mini App with i18n (EN/RU).
 */

'use client';

import { useCallback, useState, type ReactNode } from 'react';
import {
  TonConnectUIProvider,
  useTonWallet,
  useTonAddress,
  THEME,
} from '@tonconnect/ui-react';
import { AppRoot } from './AppRoot';
import { WalletConnect } from './WalletConnect';
import { WalletDashboard } from './WalletDashboard';
import { IntentInput } from './IntentInput';
import { StrategyList } from './StrategyList';
import { LangToggle } from './LangToggle';
import { I18nProvider, useI18n } from '../lib/i18n';
import { askAgent, type AgentResponse } from '../lib/api';
import type { Strategy } from '../lib/types';

// ─── TON Connect Theme ───────────────────────────────────────

const UI_PREFS = {
  theme: THEME.LIGHT,
  borderRadius: 's' as const,
  colorsSet: {
    [THEME.LIGHT]: {
      connectButton: { background: '#4DB8FF', foreground: '#FFFFFF' },
      accent: '#4DB8FF',
      telegramButton: '#4DB8FF',
      background: { primary: '#FFFFFF', secondary: '#F7F8FA', segment: '#FFFFFF', tint: '#F7F8FA', qr: '#FFFFFF' },
      text: { primary: '#0F1011', secondary: '#8E8E93' },
    },
    [THEME.DARK]: {
      connectButton: { background: '#4DB8FF', foreground: '#FFFFFF' },
      accent: '#4DB8FF',
      telegramButton: '#4DB8FF',
      background: { primary: '#1C1C1E', secondary: '#2C2C2E', segment: '#1C1C1E', tint: '#2C2C2E', qr: '#FFFFFF' },
      text: { primary: '#FFFFFF', secondary: '#8E8E93' },
    },
  },
};

export default function AppContent(): ReactNode {
  const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`;
  return (
    <I18nProvider>
      <TonConnectUIProvider manifestUrl={manifestUrl} uiPreferences={UI_PREFS}>
        <AppRoot>
          <AppInner />
        </AppRoot>
      </TonConnectUIProvider>
    </I18nProvider>
  );
}

// ─── Inner ───────────────────────────────────────────────────

function AppInner(): ReactNode {
  const wallet = useTonWallet();
  const rawAddress = useTonAddress(false);
  const connected = wallet !== null;
  const address = connected ? rawAddress : null;
  const { t } = useI18n();

  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<AgentResponse['userProfile']>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [poolsScanned, setPoolsScanned] = useState(0);
  const [processingTimeMs, setProcessingTimeMs] = useState(0);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [showStrategies, setShowStrategies] = useState(false);

  const handleIntent = useCallback(async (message: string) => {
    setLoading(true);
    setError(null);
    setAgentMessage(null);
    setLastQuery(message);
    setShowStrategies(true);
    try {
      const result = await askAgent(message, address);
      setStrategies(result.strategies);
      setAgentMessage(result.agentMessage);
      setUserProfile(result.userProfile ?? null);
      setPoolsScanned(result.poolsScanned);
      setProcessingTimeMs(result.processingTimeMs);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error');
      setStrategies([]);
    } finally {
      setLoading(false);
    }
  }, [address]);

  const handleTokenSelect = useCallback((symbol: string) => {
    void handleIntent(`${t('findStrategyFor')} ${symbol}`);
  }, [handleIntent, t]);

  const handleRefresh = useCallback(() => {
    if (lastQuery) void handleIntent(lastQuery);
  }, [lastQuery, handleIntent]);

  const handleBack = useCallback(() => {
    setShowStrategies(false);
    setStrategies([]);
    setAgentMessage(null);
    setError(null);
  }, []);

  return (
    <>
      {/* ── Header ── */}
      <header className="text-center mb-6 relative">
        {/* Language toggle — top right */}
        <div className="absolute top-0 right-0">
          <LangToggle />
        </div>

        <div className="inline-flex items-center gap-2 mb-1">
          <img src="/icon.jpg" alt="TradeMind" className="w-8 h-8 rounded-full" />
          <h1 className="text-2xl font-sans font-bold tracking-tight text-text-primary">
            TradeMind
          </h1>
        </div>
        <p className="text-sm font-sans text-text-hint mt-1">{t('subtitle')}</p>
      </header>

      {/* ── Wallet ── */}
      <div className="mb-6">
        <WalletConnect />
      </div>

      {/* ── Connected: strategies view ── */}
      {connected && address && showStrategies && (
        <>
          <button onClick={handleBack} className="flex items-center gap-1.5 mb-4 text-sm font-sans font-medium text-text-accent bg-transparent border-none cursor-pointer outline-none active:opacity-70 p-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {t('backToWallet')}
          </button>

          <div className="mb-2">
            <h2 className="section-label mb-3">{t('askQuestion')}</h2>
            <IntentInput onSubmit={handleIntent} loading={loading} disabled={false} />
          </div>

          {agentMessage && !loading && (
            <div className="rounded-tg-sm px-4 py-3 mb-6 animate-fade-in" style={{ background: 'var(--tg-theme-secondary-bg-color, #F7F8FA)' }}>
              <div className="flex gap-2.5 items-start">
                <div className="w-6 h-6 rounded-full bg-ton-blue-soft flex items-center justify-center shrink-0 mt-0.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-ton-blue" />
                </div>
                <p className="text-sm font-sans text-text-primary leading-relaxed">{agentMessage}</p>
              </div>
              {userProfile && (
                <div className="flex gap-2 mt-3 ml-8">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-medium text-text-secondary" style={{ background: 'var(--tg-theme-bg-color, #FFF)' }}>
                    {userProfile.riskLevel === 'conservative' && t('conservative')}
                    {userProfile.riskLevel === 'moderate' && t('moderate')}
                    {userProfile.riskLevel === 'aggressive' && t('aggressive')}
                  </span>
                </div>
              )}
            </div>
          )}

          <section>
            <h2 className="section-label mb-4">{loading ? t('analyzing') : t('aiRecommendations')}</h2>
            <StrategyList strategies={strategies} loading={loading} error={error} poolsScanned={poolsScanned} processingTimeMs={processingTimeMs} onRefresh={handleRefresh} />
          </section>
        </>
      )}

      {/* ── Connected: dashboard (default) ── */}
      {connected && address && !showStrategies && (
        <>
          <section className="mb-6">
            <WalletDashboard address={address} onSelectToken={handleTokenSelect} />
          </section>
          <section>
            <h2 className="section-label mb-3">{t('orAskAI')}</h2>
            <IntentInput onSubmit={handleIntent} loading={loading} disabled={false} />
          </section>
        </>
      )}

      {/* ── Not connected ── */}
      {!connected && (
        <div className="text-center py-12 animate-fade-in">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--tg-theme-secondary-bg-color, #F7F8FA)' }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M14 3L4 10L14 24L24 10L14 3Z" fill="#4DB8FF" fillOpacity="0.3"/><path d="M14 3L4 10H24L14 3Z" fill="#4DB8FF" fillOpacity="0.5"/></svg>
          </div>
          <p className="text-sm font-sans text-text-secondary leading-relaxed max-w-[280px] mx-auto">
            {t('connectPrompt')}
          </p>
        </div>
      )}

      {/* ── Footer ── */}
      <footer className="mt-10 pt-5 text-center" style={{ borderTop: '1px solid var(--tg-theme-secondary-bg-color, #F3F4F6)' }}>
        <p className="text-xs font-sans" style={{ color: 'var(--tg-theme-hint-color, #999)' }}>TradeMind v0.1.0 — powered by Gemini</p>
        <p className="text-xs font-sans mt-1" style={{ color: 'var(--tg-theme-hint-color, #999)' }}>{t('noKeyAccess')}</p>
      </footer>
    </>
  );
}
