/**
 * StrategyCard — Display-only DeFi strategy recommendation.
 *
 * No transaction sending — just shows AI-recommended strategy.
 * Uses Telegram theme vars everywhere — no hardcoded white/gray.
 * Progressive disclosure: name + APY visible, details in accordion.
 */

'use client';

import { useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import type { Strategy } from '../lib/types';
import { formatUsd, formatProtocol, riskLevelColor, riskLevelLabel } from '../lib/types';

interface StrategyCardProps {
  readonly strategy: Strategy;
  readonly index: number;
}

export function StrategyCard({ strategy, index }: StrategyCardProps): ReactNode {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { t } = useI18n();
  const riskColor = riskLevelColor(strategy.ilRisk.riskLevel);

  return (
    <div
      className="card mb-4 animate-slide-up"
      style={{ animationDelay: `${index * 0.07}s`, animationFillMode: 'backwards' }}
    >
      {/* Header: Name (link to pool) + Protocol */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="flex-1 min-w-0 font-sans text-lg font-bold leading-snug">
          {strategy.poolUrl ? (
            <a
              href={strategy.poolUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-accent no-underline transition-opacity duration-150 hover:opacity-75 active:opacity-60"
              style={{ textDecoration: 'none' }}
            >
              {strategy.name}
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                className="inline-block ml-1.5 -mt-0.5 opacity-50"
              >
                <path
                  d="M5.5 2.5H3C2.72386 2.5 2.5 2.72386 2.5 3V11C2.5 11.2761 2.72386 11.5 3 11.5H11C11.2761 11.5 11.5 11.2761 11.5 11V8.5M8 2.5H11.5V6M11.25 2.75L6.5 7.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          ) : (
            <span className="text-text-primary">{strategy.name}</span>
          )}
        </h3>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-sans font-semibold tracking-wide bg-ton-blue-soft text-ton-blue shrink-0 mt-0.5">
          {formatProtocol(strategy.protocol)}
        </span>
      </div>

      {/* APY — hero number */}
      <div className="mb-4">
        <span className="text-xs font-sans text-text-hint uppercase tracking-wider">
          {t('estYield')}
        </span>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="font-mono text-3xl font-bold text-ton-blue leading-none">
            {strategy.estimatedApyPercent.toFixed(2)}
          </span>
          <span className="font-mono text-lg font-medium text-ton-blue">
            % APY
          </span>
        </div>
      </div>

      {/* Accordion trigger */}
      <button
        onClick={() => setDetailsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between py-3 bg-transparent cursor-pointer text-sm font-sans font-medium text-text-secondary outline-none transition-colors duration-150 hover:text-text-primary"
        style={{ borderTop: '1px solid var(--tg-theme-secondary-bg-color, #F3F4F6)', borderBottom: 'none', paddingLeft: 0, paddingRight: 0 }}
        aria-expanded={detailsOpen}
      >
        <span>{detailsOpen ? t('hideDetails') : t('showDetails')}</span>
        <span className="accordion-chevron text-text-hint text-xs" data-open={detailsOpen}>▼</span>
      </button>

      {/* Accordion content */}
      <div className="accordion-content" data-open={detailsOpen}>
        <div className="accordion-inner">
          <div className="pt-2 pb-2 space-y-2">
            <div className="metric-row">
              <span className="metric-label">{t('pair')}</span>
              <span className="text-sm font-sans font-semibold text-text-primary">{strategy.pair}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">{t('poolTvl')}</span>
              <span className="metric-value">{formatUsd(strategy.poolTvlUsd)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">{t('volume24h')}</span>
              <span className="metric-value">{formatUsd(strategy.volume24hUsd)}</span>
            </div>

            <div style={{ borderTop: '1px solid var(--tg-theme-secondary-bg-color, #F3F4F6)', margin: '4px 0' }} />

            <div className="metric-row">
              <span className="metric-label">{t('ilRisk')}</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-semibold"
                style={{ color: riskColor, backgroundColor: `color-mix(in srgb, ${riskColor} 8%, transparent)` }}>
                {riskLevelLabel(strategy.ilRisk.riskLevel)} {(strategy.ilRisk.worstCaseIlPercent * 100).toFixed(1)}%
              </span>
            </div>
            <div className="metric-row">
              <span className="metric-label">{t('expectedIl')}</span>
              <span className="text-sm font-mono text-text-secondary">
                {(strategy.ilRisk.expectedIlPercent * 100).toFixed(2)}%
              </span>
            </div>

            <div style={{ borderTop: '1px solid var(--tg-theme-secondary-bg-color, #F3F4F6)', margin: '4px 0' }} />

            {/* Score */}
            <div className="mb-3">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs font-sans text-text-hint">{t('strategyScore')}</span>
                <span className="text-xs font-mono font-bold text-text-primary">{strategy.score}/100</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${strategy.score}%` }} />
              </div>
            </div>

            {/* AI Rationale */}
            <div className="rounded-tg-xs p-4" style={{ background: 'var(--tg-theme-secondary-bg-color, #F7F8FA)' }}>
              <span className="text-[11px] font-sans font-semibold text-text-hint uppercase tracking-wider">
                {t('aiAnalysis')}
              </span>
              <p className="text-sm font-sans leading-relaxed text-text-primary mt-2">
                {strategy.rationale}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
