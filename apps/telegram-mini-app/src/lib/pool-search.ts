/**
 * Pool Search — finds real DEX pools on TON for ANY token.
 *
 * Uses DexScreener API (best TON coverage, no auth required).
 * Fallback: GeckoTerminal.
 *
 * DexScreener indexes STON.fi, DeDust, and all TON DEXs.
 */

export interface RealPool {
  id: string;
  protocol: 'stonfi' | 'dedust';
  pair: string;
  token0Symbol: string;
  token1Symbol: string;
  poolAddress: string;
  poolUrl: string;
  tvlUsd: number;
  apyPercent: number;
  volume24hUsd: number;
  riskLevel: string;
}

/**
 * Search pools via DexScreener — finds ANY token on TON.
 */
async function searchDexScreener(query: string): Promise<RealPool[]> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(8000) },
    );

    if (!res.ok) {
      console.error(`[pools] DexScreener error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const pairs: unknown[] = data.pairs ?? [];

    // Filter only TON chain pools
    const tonPools = pairs.filter((p: unknown) => {
      const pair = p as Record<string, unknown>;
      const chainId = str(pair.chainId);
      return chainId === 'ton';
    });

    console.log(`[pools] DexScreener: ${pairs.length} total, ${tonPools.length} on TON for "${query}"`);

    return tonPools.slice(0, 8).map((p: unknown) => {
      const pair = p as Record<string, unknown>;
      const baseToken = (pair.baseToken ?? {}) as Record<string, unknown>;
      const quoteToken = (pair.quoteToken ?? {}) as Record<string, unknown>;

      const baseSym = str(baseToken.symbol) || 'UNKNOWN';
      const quoteSym = str(quoteToken.symbol) || 'UNKNOWN';
      const pairAddress = str(pair.pairAddress);
      const dexId = str(pair.dexId).toLowerCase();

      console.log(`[pools] Pool ${baseSym}/${quoteSym}: dexId="${dexId}", address=${pairAddress.slice(0, 16)}...`);

      // Detect protocol from dexId
      const isStonfi = dexId.includes('ston');
      const isDedust = dexId.includes('dedust') || dexId.includes('de_dust');
      const protocol: 'stonfi' | 'dedust' = isStonfi ? 'stonfi' : 'dedust';

      // Build link to actual DEX pool page
      let poolUrl: string;
      if (isStonfi) {
        poolUrl = `https://app.ston.fi/pools/${pairAddress}`;
      } else if (isDedust) {
        poolUrl = `https://dedust.io/pools/${pairAddress}`;
      } else {
        // Unknown DEX on TON — try both swap pages with token address
        const baseAddr = str(baseToken.address);
        if (baseAddr) {
          poolUrl = `https://app.ston.fi/swap?chartVisible=false&ft=${baseAddr}&tt=TON`;
        } else {
          poolUrl = `https://app.ston.fi/pools/${pairAddress}`;
        }
      }

      const liquidity = (pair.liquidity ?? {}) as Record<string, unknown>;
      const tvl = num(liquidity.usd ?? 0);
      const volumeObj = (pair.volume ?? {}) as Record<string, unknown>;
      const volume24h = num(volumeObj.h24 ?? 0);

      // Estimate APY from volume/TVL ratio
      const apy = tvl > 0 ? (volume24h * 0.003 * 365 / tvl) * 100 : 0;

      return {
        id: `dex-${pairAddress.slice(-8)}`,
        protocol,
        pair: `${baseSym}/${quoteSym}`,
        token0Symbol: baseSym,
        token1Symbol: quoteSym,
        poolAddress: pairAddress,
        poolUrl,
        tvlUsd: tvl,
        apyPercent: Math.min(apy, 500),
        volume24hUsd: volume24h,
        riskLevel: classifyRisk(baseSym, quoteSym, tvl),
      };
    }).filter((p: RealPool) => p.token0Symbol !== 'UNKNOWN' && p.tvlUsd > 100);
  } catch (error) {
    console.error('[pools] DexScreener error:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Search via GeckoTerminal as backup.
 */
async function searchGeckoTerminal(query: string): Promise<RealPool[]> {
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(query)}&network=ton&page=1`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
    );

    if (!res.ok) {
      console.error(`[pools] GeckoTerminal error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const pools = data?.data ?? [];

    return pools.slice(0, 5).map((item: Record<string, unknown>) => {
      const attrs = (item.attributes ?? {}) as Record<string, unknown>;
      const name = str(attrs.name);
      const address = str(attrs.address);
      const reserveUsd = num(attrs.reserve_in_usd ?? 0);
      const volumeObj = (attrs.volume_usd ?? {}) as Record<string, unknown>;
      const volume24h = num(volumeObj.h24 ?? 0);
      const baseToken = (attrs.base_token ?? {}) as Record<string, unknown>;
      const quoteToken = (attrs.quote_token ?? {}) as Record<string, unknown>;
      const baseSym = str(baseToken.symbol);
      const quoteSym = str(quoteToken.symbol);

      const isStonPool = name.toLowerCase().includes('ston');

      return {
        id: `gecko-${address.slice(-8)}`,
        protocol: (isStonPool ? 'stonfi' : 'dedust') as 'stonfi' | 'dedust',
        pair: (baseSym && quoteSym) ? `${baseSym}/${quoteSym}` : name,
        token0Symbol: baseSym || 'UNKNOWN',
        token1Symbol: quoteSym || 'UNKNOWN',
        poolAddress: address,
        poolUrl: isStonPool
          ? `https://app.ston.fi/pools/${address}`
          : `https://dedust.io/pools/${address}`,
        tvlUsd: reserveUsd,
        apyPercent: reserveUsd > 0 ? Math.min((volume24h * 0.003 * 365 / reserveUsd) * 100, 500) : 0,
        volume24hUsd: volume24h,
        riskLevel: classifyRisk(baseSym, quoteSym, reserveUsd),
      };
    }).filter((p: RealPool) => p.token0Symbol !== 'UNKNOWN');
  } catch (error) {
    console.error('[pools] GeckoTerminal error:', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Search all sources and combine.
 */
export async function searchAllPools(query: string): Promise<RealPool[]> {
  // Try DexScreener first (best coverage)
  const dexPools = await searchDexScreener(query);

  if (dexPools.length > 0) {
    console.log(`[pools] Found ${dexPools.length} pools for "${query}" via DexScreener`);
    return dexPools.slice(0, 6);
  }

  // Fallback to GeckoTerminal
  const geckoPools = await searchGeckoTerminal(query);
  console.log(`[pools] Found ${geckoPools.length} pools for "${query}" via GeckoTerminal`);

  return geckoPools.slice(0, 6);
}

// ─── Helpers ─────────────────────────────────────────────────

function str(val: unknown): string {
  if (typeof val === 'string' && val.length > 0) return val;
  return '';
}

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

const STABLES = ['USDT', 'USDC', 'DAI', 'JUSDT', 'JUSDC', 'TUSD', 'BUSD'];

function classifyRisk(t0: string, t1: string, tvl: number): string {
  const s0 = STABLES.includes(t0.toUpperCase());
  const s1 = STABLES.includes(t1.toUpperCase());
  if (s0 && s1) return 'low';
  if (tvl > 5_000_000) return 'medium';
  if (tvl > 1_000_000) return 'medium';
  return 'high';
}
