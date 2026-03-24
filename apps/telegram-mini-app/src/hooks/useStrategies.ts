/**
 * useStrategies Hook
 *
 * Manages the lifecycle of strategy discovery:
 * 1. Triggers fetch when wallet is connected
 * 2. Tracks loading / error / data states
 * 3. Provides refresh capability
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchStrategies } from '../lib/api';
import type { Strategy } from '../lib/types';

interface StrategiesState {
  /** Fetched strategies (empty if loading or error) */
  readonly strategies: readonly Strategy[];

  /** Number of pools scanned by the backend */
  readonly poolsScanned: number;

  /** Whether strategies are currently loading */
  readonly loading: boolean;

  /** Error message if fetch failed */
  readonly error: string | null;

  /** Backend processing time in ms */
  readonly processingTimeMs: number;

  /** Re-fetch strategies */
  readonly refresh: () => void;
}

/**
 * Fetches strategies from the backend when a wallet address is provided.
 *
 * @param walletAddress - Connected wallet address, or null if not connected
 */
export function useStrategies(walletAddress: string | null): StrategiesState {
  const [strategies, setStrategies] = useState<readonly Strategy[]>([]);
  const [poolsScanned, setPoolsScanned] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingTimeMs, setProcessingTimeMs] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (walletAddress === null) {
      setStrategies([]);
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadStrategies(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const result = await fetchStrategies(walletAddress as string);

        if (!cancelled) {
          setStrategies(result.strategies);
          setPoolsScanned(result.poolsScanned);
          setProcessingTimeMs(result.processingTimeMs);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error
            ? err.message
            : 'Failed to load strategies';
          setError(message);
          setStrategies([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadStrategies();

    return () => {
      cancelled = true;
    };
  }, [walletAddress, refreshKey]);

  return {
    strategies,
    poolsScanned,
    loading,
    error,
    processingTimeMs,
    refresh,
  };
}
