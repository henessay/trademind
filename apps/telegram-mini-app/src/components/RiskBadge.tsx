/**
 * RiskBadge — Impermanent loss risk indicator.
 *
 * Color-coded badge using Telegram theme variables:
 * - Low: link color (blue)
 * - Medium: accent/warning (amber)
 * - High/Extreme: destructive (red)
 */

'use client';

import type { ReactNode } from 'react';
import type { RiskLevel } from '../lib/types';
import { riskLevelColor, riskLevelLabel } from '../lib/types';

interface RiskBadgeProps {
  readonly level: RiskLevel;
  readonly ilPercent: number;
}

export function RiskBadge({ level, ilPercent }: RiskBadgeProps): ReactNode {
  const color = riskLevelColor(level);
  const label = riskLevelLabel(level);

  return (
    <span
      className="badge"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {label} ({(ilPercent * 100).toFixed(1)}%)
    </span>
  );
}
