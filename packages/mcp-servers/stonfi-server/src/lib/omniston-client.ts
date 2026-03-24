/**
 * Omniston Client — RxJS Reactive Stream Wrapper
 *
 * Omniston is STON.fi's cross-DEX liquidity aggregation protocol.
 * It uses WebSocket connections to stream quotes from multiple resolvers
 * (liquidity sources) simultaneously, enabling Best Price Discovery.
 *
 * Architecture:
 * 1. Client opens a WebSocket to Omniston gateway
 * 2. Sends a quote request with asset pair + amount
 * 3. Multiple resolvers stream quotes back as RxJS Observables
 * 4. Client collects quotes within a time window
 * 5. Best quote is selected by exchange rate
 *
 * The RxJS Observable pattern is ideal here because:
 * - Multiple quotes arrive asynchronously from different resolvers
 * - We need to collect within a timeout window
 * - Quotes must be sorted and filtered in real-time
 */

import {
  Observable,
  Subject,
  firstValueFrom,
  takeUntil,
  timeout,
  toArray,
  filter,
  map,
  scan,
  catchError,
  of,
  timer,
} from 'rxjs';
import type {
  GetStonfiQuoteParams,
  StonfiQuote,
  QuoteDiscoveryResult,
} from '../types.js';

/** Default timeout for quote discovery */
const DEFAULT_QUOTE_TIMEOUT_MS = 10_000;

/** Maximum slippage cap — safety limit per CLAUDE.md §10 */
const MAX_SLIPPAGE_CAP = 0.15; // 15%

/** Default slippage tolerance */
const DEFAULT_SLIPPAGE = 0.01; // 1%

/**
 * Raw quote from Omniston resolver stream.
 * This is what we receive from the WebSocket before mapping to our types.
 */
interface OmnistonRawQuote {
  readonly offer_asset_address: string;
  readonly ask_asset_address: string;
  readonly offer_units: string;
  readonly ask_units: string;
  readonly resolver_id: string;
  readonly settlement_address: string;
  readonly route_path: readonly string[];
  readonly expires_at: number;
}

/**
 * Interface for the underlying Omniston transport layer.
 * Injected for testability — production uses the actual @ston-fi/omniston-sdk.
 */
export interface OmnistonTransport {
  /**
   * Opens a quote stream for a given asset pair.
   * Returns an Observable that emits raw quotes as they arrive from resolvers.
   */
  requestQuoteStream(
    offerAssetAddress: string,
    askAssetAddress: string,
    offerUnits: string,
  ): Observable<OmnistonRawQuote>;

  /**
   * Closes the underlying connection.
   */
  disconnect(): void;
}

/**
 * Omniston client for Best Price Discovery.
 *
 * Uses RxJS to:
 * - Stream quotes from multiple resolvers via Observable
 * - Collect within a time-bounded window
 * - Sort by exchange rate, filter by slippage
 * - Return the optimal quote
 */
export class OmnistonClient {
  private readonly transport: OmnistonTransport;
  private readonly destroy$ = new Subject<void>();

  constructor(transport: OmnistonTransport) {
    this.transport = transport;
  }

  /**
   * Discovers the best swap quote across all Omniston resolvers.
   *
   * Flow (RxJS pipeline):
   * 1. transport.requestQuoteStream() → Observable<RawQuote>
   * 2. pipe(timeout) → cut off after timeoutMs
   * 3. pipe(map) → transform to StonfiQuote
   * 4. pipe(filter) → reject quotes exceeding slippage
   * 5. pipe(toArray) → collect all quotes
   * 6. Sort by exchange rate → pick best
   *
   * @param params - Quote request parameters
   * @returns Best quote and all alternatives found during discovery
   *
   * @throws Error if no quotes received within timeout
   * @throws Error if all quotes exceed slippage tolerance
   */
  async discoverBestQuote(
    params: GetStonfiQuoteParams,
  ): Promise<QuoteDiscoveryResult> {
    const timeoutMs = params.timeoutMs ?? DEFAULT_QUOTE_TIMEOUT_MS;
    const maxSlippage = Math.min(
      params.maxSlippage ?? DEFAULT_SLIPPAGE,
      MAX_SLIPPAGE_CAP,
    );

    const startTime = Date.now();

    // Open reactive quote stream from Omniston
    const rawQuotes$ = this.transport.requestQuoteStream(
      params.offerAssetAddress,
      params.askAssetAddress,
      params.offerUnits,
    );

    // RxJS pipeline: transform → filter → collect
    const allQuotes = await firstValueFrom(
      rawQuotes$.pipe(
        // Safety: auto-cancel on destroy
        takeUntil(this.destroy$),

        // Time-bound the discovery window
        takeUntil(timer(timeoutMs)),

        // Transform raw protocol format → our strict types
        map((raw) => mapRawQuote(raw, params.offerUnits)),

        // Filter out quotes that exceed slippage tolerance
        filter((quote) => quote.priceImpact <= maxSlippage),

        // Collect all quotes into an array when stream completes
        toArray(),

        // Handle empty results gracefully
        catchError((error: unknown) => {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          if (msg.includes('Timeout') || msg.includes('no elements')) {
            return of([]);
          }
          throw error;
        }),
      ),
    );

    if (allQuotes.length === 0) {
      throw new Error(
        `No valid quotes found for ${params.offerAssetAddress} → ${params.askAssetAddress} ` +
        `within ${timeoutMs}ms (max slippage: ${(maxSlippage * 100).toFixed(1)}%). ` +
        'Try increasing slippage tolerance or timeout.',
      );
    }

    // Sort by exchange rate — highest rate first (best deal for user)
    const sorted = [...allQuotes].sort(
      (a, b) => b.exchangeRate - a.exchangeRate,
    );

    const discoveryTimeMs = Date.now() - startTime;

    // Count unique resolvers
    const uniqueResolvers = new Set(sorted.map((q) => q.resolverId));

    return {
      bestQuote: sorted[0],
      allQuotes: sorted,
      resolversResponded: uniqueResolvers.size,
      discoveryTimeMs,
    };
  }

  /**
   * Creates a live quote stream that emits progressive best-quote updates.
   *
   * Unlike discoverBestQuote() which waits for all quotes, this Observable
   * emits every time a new best quote is found — useful for showing
   * real-time updates in the UI.
   *
   * @param params - Quote request parameters
   * @returns Observable that emits the running best quote
   */
  streamBestQuote(
    params: GetStonfiQuoteParams,
  ): Observable<StonfiQuote> {
    const timeoutMs = params.timeoutMs ?? DEFAULT_QUOTE_TIMEOUT_MS;
    const maxSlippage = Math.min(
      params.maxSlippage ?? DEFAULT_SLIPPAGE,
      MAX_SLIPPAGE_CAP,
    );

    const rawQuotes$ = this.transport.requestQuoteStream(
      params.offerAssetAddress,
      params.askAssetAddress,
      params.offerUnits,
    );

    return rawQuotes$.pipe(
      takeUntil(this.destroy$),
      takeUntil(timer(timeoutMs)),
      map((raw) => mapRawQuote(raw, params.offerUnits)),
      filter((quote) => quote.priceImpact <= maxSlippage),
      // scan: keep only the best quote seen so far
      scan((best: StonfiQuote | null, current: StonfiQuote) => {
        if (best === null || current.exchangeRate > best.exchangeRate) {
          return current;
        }
        return best;
      }, null),
      filter((quote): quote is StonfiQuote => quote !== null),
    );
  }

  /**
   * Gracefully shuts down all active streams.
   */
  dispose(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.transport.disconnect();
  }
}

// ─── Mapping Helpers ─────────────────────────────────────────

function mapRawQuote(
  raw: OmnistonRawQuote,
  offerUnits: string,
): StonfiQuote {
  const offerNum = parseFloat(offerUnits);
  const askNum = parseFloat(raw.ask_units);
  const exchangeRate = offerNum > 0 ? askNum / offerNum : 0;

  // Estimate price impact from deviation vs. mid-market
  // A more sophisticated version would compare against an oracle price
  const priceImpact = estimatePriceImpact(offerNum, askNum);

  return {
    offerAssetAddress: raw.offer_asset_address,
    askAssetAddress: raw.ask_asset_address,
    offerUnits: raw.offer_units,
    askUnits: raw.ask_units,
    exchangeRate,
    priceImpact,
    routePath: raw.route_path,
    resolverId: raw.resolver_id,
    settlementAddress: raw.settlement_address,
    expiresAt: new Date(raw.expires_at * 1000).toISOString(),
  };
}

/**
 * Estimates price impact based on the quote size.
 * In production, this would compare against a reference/oracle price.
 * For now, we use a simple heuristic based on the exchange rate deviation.
 */
function estimatePriceImpact(offerAmount: number, askAmount: number): number {
  if (offerAmount <= 0 || askAmount <= 0) return 1;

  // Logarithmic impact model:
  // Larger trades relative to pool liquidity have higher impact
  // This is a placeholder — production should use pool depth data
  const logRatio = Math.abs(Math.log(askAmount / offerAmount));
  return Math.min(logRatio * 0.01, 1);
}
