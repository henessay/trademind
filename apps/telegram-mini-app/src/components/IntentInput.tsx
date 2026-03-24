/**
 * IntentInput — Natural language input for investment intent.
 *
 * User types what they want, e.g.:
 *   "Хочу вложить 50 TON безопасно"
 *   "Максимальная доходность, готов рисковать"
 *   "Куда вложить стейблкойны?"
 *
 * Sends to /api/agent → Claude analyzes → returns strategies.
 */

'use client';

import { useState, useCallback, type ReactNode, type FormEvent } from 'react';
import { useI18n } from '../lib/i18n';

interface IntentInputProps {
  readonly onSubmit: (message: string) => void;
  readonly loading: boolean;
  readonly disabled: boolean;
}

const SUGGESTION_KEYS = ['suggestSafe', 'suggestMax', 'suggestTon'] as const;

export function IntentInput({
  onSubmit,
  loading,
  disabled,
}: IntentInputProps): ReactNode {
  const [message, setMessage] = useState('');
  const { t } = useI18n();

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = message.trim();
      if (trimmed.length === 0 || loading || disabled) return;
      onSubmit(trimmed);
    },
    [message, onSubmit, loading, disabled],
  );

  const handleSuggestion = useCallback(
    (text: string) => {
      if (loading || disabled) return;
      setMessage(text);
      onSubmit(text);
    },
    [onSubmit, loading, disabled],
  );

  return (
    <div className="mb-6">
      {/* Input form */}
      <div
        className="
          flex items-center gap-2
          bg-surface-section rounded-tg
          p-1.5 pl-4
          transition-all duration-200
        "
        style={{ border: '1px solid var(--tg-theme-secondary-bg-color, #F3F4F6)' }}
      >
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit(e);
          }}
          placeholder={t('placeholder')}
          disabled={loading || disabled}
          className="
            flex-1 bg-transparent border-none outline-none
            font-sans text-sm text-text-primary
            placeholder:text-text-hint
            disabled:opacity-50
          "
        />
        <button
          onClick={handleSubmit}
          disabled={message.trim().length === 0 || loading || disabled}
          className="
            shrink-0 w-10 h-10 rounded-tg-sm
            flex items-center justify-center
            transition-all duration-150
            disabled:opacity-30 disabled:cursor-not-allowed
            active:scale-95
            border-none outline-none cursor-pointer
          "
          style={{
            background:
              message.trim().length > 0 && !loading
                ? '#4DB8FF'
                : 'transparent',
          }}
        >
          {loading ? (
            <div
              className="w-5 h-5 rounded-full animate-spin"
              style={{
                border: '2px solid #E5E7EB',
                borderTopColor: '#4DB8FF',
              }}
            />
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
            >
              <path
                d="M3 9H15M15 9L10 4M15 9L10 14"
                stroke={message.trim().length > 0 ? '#FFFFFF' : '#C7C7CC'}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Quick suggestions */}
      <div className="flex flex-wrap gap-2 mt-3">
        {SUGGESTION_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => handleSuggestion(t(key))}
            disabled={loading || disabled}
            className="
              px-3 py-1.5 rounded-full
              text-xs font-sans font-medium
              bg-surface-secondary text-text-secondary
              border-none cursor-pointer outline-none
              transition-all duration-150
              hover:bg-ton-blue-soft hover:text-ton-blue
              active:scale-95
              disabled:opacity-40 disabled:cursor-not-allowed
            "
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
