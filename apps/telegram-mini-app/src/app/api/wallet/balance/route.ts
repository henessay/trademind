/**
 * GET /api/wallet/balance?address=...
 *
 * tonapi.io response format (confirmed from docs):
 * {
 *   "balances": [{
 *     "balance": "1000000000",
 *     "wallet_address": { "address": "0:..." },
 *     "jetton": {
 *       "address": "0:...",
 *       "name": "Notcoin",
 *       "symbol": "NOT",
 *       "decimals": 9,
 *       "image": "https://...",
 *       "verification": "whitelist"
 *     },
 *     "price": { "prices": { "USD": 0.0065 } }
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const address = request.nextUrl.searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 });
  }

  console.log(`[wallet] Fetching balance for ${address.slice(0, 10)}...`);

  const tokens: {
    symbol: string;
    name: string;
    balance: string;
    balanceUsd: number;
    decimals: number;
    iconUrl: string | null;
    jettonAddress: string | null;
  }[] = [];

  try {
    // 1. TON balance
    let tonBalance = 0;
    try {
      const res = await fetch(`https://tonapi.io/v2/accounts/${encodeURIComponent(address)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        tonBalance = (data.balance ?? 0) / 1e9;
        console.log(`[wallet] TON balance: ${tonBalance}`);
      } else {
        console.error(`[wallet] TON balance error: ${res.status}`);
      }
    } catch (e) {
      console.error(`[wallet] TON balance fetch failed: ${e}`);
    }

    tokens.push({
      symbol: 'TON',
      name: 'Toncoin',
      balance: tonBalance.toFixed(4),
      balanceUsd: tonBalance * 3.45,
      decimals: 9,
      iconUrl: 'https://ton.org/download/ton_symbol.svg',
      jettonAddress: null,
    });

    // 2. Jettons
    try {
      const url = `https://tonapi.io/v2/accounts/${encodeURIComponent(address)}/jettons?currencies=usd`;
      console.log(`[wallet] Fetching jettons: ${url.slice(0, 80)}...`);

      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      console.log(`[wallet] Jettons response status: ${res.status}`);

      if (res.ok) {
        const text = await res.text();
        console.log(`[wallet] Raw response length: ${text.length}`);
        console.log(`[wallet] Raw response start: ${text.slice(0, 300)}`);

        const data = JSON.parse(text);
        const balances = data.balances ?? [];
        console.log(`[wallet] Parsed ${balances.length} jettons`);

        for (let i = 0; i < balances.length; i++) {
          const item = balances[i];

          // Log raw structure for first 2 items
          if (i < 2) {
            console.log(`[wallet] Jetton[${i}] keys: ${Object.keys(item).join(', ')}`);
            if (item.jetton) {
              console.log(`[wallet] Jetton[${i}].jetton keys: ${Object.keys(item.jetton).join(', ')}`);
              console.log(`[wallet] Jetton[${i}].jetton.symbol = "${item.jetton.symbol}"`);
              console.log(`[wallet] Jetton[${i}].jetton.name = "${item.jetton.name}"`);
            } else {
              console.log(`[wallet] Jetton[${i}] has NO .jetton field!`);
              console.log(`[wallet] Jetton[${i}] full: ${JSON.stringify(item).slice(0, 300)}`);
            }
          }

          // Extract metadata — tonapi.io puts it under .jetton
          const jetton = item.jetton;
          if (!jetton) {
            console.log(`[wallet] Skipping jetton[${i}] — no jetton field`);
            continue;
          }

          const symbol = jetton.symbol || null;
          const name = jetton.name || symbol || 'Unknown';
          const decimals = Number(jetton.decimals ?? 9);
          const image = jetton.image || null;
          const jettonAddr = jetton.address || null;

          const rawBal = String(item.balance ?? '0');
          const numBal = parseInt(rawBal, 10) / Math.pow(10, decimals);
          if (numBal < 0.0001) continue;

          // Price
          let priceUsd = 0;
          if (item.price?.prices?.USD) {
            priceUsd = Number(item.price.prices.USD);
          }

          tokens.push({
            symbol: symbol || name.slice(0, 6).toUpperCase(),
            name,
            balance: numBal > 1000 ? numBal.toFixed(2) : numBal > 1 ? numBal.toFixed(4) : numBal.toFixed(6),
            balanceUsd: numBal * priceUsd,
            decimals,
            iconUrl: image,
            jettonAddress: jettonAddr,
          });
        }
      } else {
        const errText = await res.text();
        console.error(`[wallet] Jettons error ${res.status}: ${errText.slice(0, 200)}`);
      }
    } catch (e) {
      console.error(`[wallet] Jettons fetch failed: ${e}`);
    }

    tokens.sort((a, b) => b.balanceUsd - a.balanceUsd);

    console.log(`[wallet] Returning ${tokens.length} tokens`);

    return NextResponse.json({
      tokens,
      totalBalanceUsd: tokens.reduce((s, t) => s + t.balanceUsd, 0),
      address,
    });
  } catch (error) {
    console.error('[wallet] Fatal error:', error);
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
  }
}
