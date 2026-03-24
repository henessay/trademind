/**
 * TransactionStatus — Displays the current transaction signing state.
 *
 * States:
 * - idle: nothing shown
 * - confirming: strategy details before signing
 * - signing: spinner while wallet processes
 * - success: green checkmark + tx hash
 * - error: red error message
 */

'use client';

import type { ReactNode } from 'react';
import type { TransactionState } from '../lib/types';

interface TransactionStatusProps {
  readonly state: TransactionState;
  readonly onDismiss: () => void;
}

export function TransactionStatus({
  state,
  onDismiss,
}: TransactionStatusProps): ReactNode {
  if (state.status === 'idle') return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {state.status === 'signing' && (
        <div className="status-signing">
          <div className="spinner" />
          <p style={{ marginTop: 12, fontSize: 15 }}>
            Подтвердите транзакцию в кошельке...
          </p>
          <p style={{ marginTop: 4, fontSize: 13 }}>
            Проверьте детали и подтвердите биометрией
          </p>
        </div>
      )}

      {state.status === 'success' && (
        <div className="status-success">
          <div style={{ fontSize: 40, marginBottom: 8 }}>&#10003;</div>
          <p style={{ fontSize: 16, fontWeight: 600 }}>
            Транзакция отправлена!
          </p>
          <p
            style={{
              marginTop: 8,
              fontSize: 12,
              color: 'var(--tg-theme-hint-color)',
              wordBreak: 'break-all',
            }}
          >
            {state.txHash.slice(0, 24)}...
          </p>
          <button
            className="btn-secondary"
            style={{ marginTop: 16 }}
            onClick={onDismiss}
          >
            Готово
          </button>
        </div>
      )}

      {state.status === 'error' && (
        <div className="status-error">
          <p style={{ fontSize: 16, fontWeight: 600 }}>Ошибка</p>
          <p style={{ marginTop: 8, fontSize: 14 }}>
            {state.message}
          </p>
          <button
            className="btn-secondary"
            style={{ marginTop: 16 }}
            onClick={onDismiss}
          >
            Попробовать снова
          </button>
        </div>
      )}
    </div>
  );
}
