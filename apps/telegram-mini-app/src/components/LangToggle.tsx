'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

export function LangToggle(): ReactNode {
  const { lang, toggle } = useI18n();

  return (
    <button
      onClick={toggle}
      className="
        px-2.5 py-1 rounded-full
        text-xs font-mono font-semibold
        cursor-pointer outline-none border-none
        transition-all duration-150
        active:scale-95
      "
      style={{
        background: 'var(--tg-theme-secondary-bg-color, #F0F0F0)',
        color: 'var(--tg-theme-hint-color, #999)',
      }}
      aria-label="Switch language"
    >
      {lang === 'en' ? 'RU' : 'EN'}
    </button>
  );
}
