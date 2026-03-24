'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import type { Strategy } from '../lib/types';
import { StrategyCard } from './StrategyCard';

interface StrategyListProps {
  readonly strategies: readonly Strategy[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly poolsScanned: number;
  readonly processingTimeMs: number;
  readonly onRefresh: () => void;
}

export function StrategyList({ strategies, loading, error, poolsScanned, processingTimeMs, onRefresh }: StrategyListProps): ReactNode {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="text-center py-16 animate-fade-in">
        <div className="spinner mx-auto" />
        <p className="text-sm text-text-secondary mt-4 font-sans">{t('aiSearching')}</p>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="text-center py-16 animate-fade-in">
        <p className="text-sm text-status-danger mb-4 font-sans">{error}</p>
        <button className="btn-ghost max-w-[200px] mx-auto" onClick={onRefresh}>{t('tryAgain')}</button>
      </div>
    );
  }

  if (strategies.length === 0) return null;

  return (
    <div>
      <div className="flex justify-between items-center mb-4 px-1">
        <span className="text-xs text-text-hint font-sans">
          <span className="font-mono">{strategies.length}</span> / <span className="font-mono">{poolsScanned}</span> {t('pools')}
        </span>
        <span className="text-xs text-text-hint font-mono">{(processingTimeMs / 1000).toFixed(1)}s</span>
      </div>
      <div className="space-y-4">
        {strategies.map((strategy, index) => (
          <StrategyCard key={strategy.id} strategy={strategy} index={index} />
        ))}
      </div>
      <button className="btn-ghost mt-6" onClick={onRefresh}>{t('refreshStrategies')}</button>
    </div>
  );
}
