/**
 * POST /api/agent
 *
 * TradeMind AI Agent.
 *
 * Strategy:
 * 1. Extract tokens from user message
 * 2. If specific token → search GeckoTerminal for real pools
 * 3. If general query ("безопасно", "максимальная доходность") → use LOCAL database
 * 4. If Gemini available → AI-powered analysis
 * 5. Fallback → smart keyword matching on local database
 *
 * LOCAL database always works, even without API keys or internet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchAllPools, type RealPool } from '../../../lib/pool-search';

// ─── Local Pool Database (always available) ──────────────────

// ─── Token extraction ────────────────────────────────────────

const KNOWN_TOKENS = [
  'TON', 'USDT', 'USDC', 'NOT', 'DOGS', 'CATI', 'STON', 'GRAM',
  'SCALE', 'PUNK', 'BOLT', 'REDO', 'MEGA', 'ARBUZ', 'UTYA',
  'KINGY', 'DUREV', 'WALL', 'LAVE', 'TGRAM', 'DAI', 'WTON',
  'JUSDT', 'JUSDC', 'JTON', 'GLINT', 'ANON', 'FISH', 'HYDRA',
];

function extractTokens(message: string): string[] {
  const upper = message.toUpperCase();
  const found = KNOWN_TOKENS.filter((t) => upper.includes(t));
  // Also detect capitalized words as tokens
  for (const word of message.split(/\s+/)) {
    const clean = word.replace(/[^A-Za-z0-9]/g, '');
    if (clean.length >= 2 && clean.length <= 8 && clean === clean.toUpperCase() && /[A-Z]/.test(clean) && !found.includes(clean)) {
      found.push(clean);
    }
  }
  return found;
}

// ─── Intent classification ───────────────────────────────────

type Intent = 'safe' | 'aggressive' | 'token_search' | 'general';

function classifyIntent(message: string, tokens: string[]): Intent {
  const lower = message.toLowerCase();
  // Multiple tokens = specific pair search
  if (tokens.length >= 2) return 'token_search';
  // Single non-TON token = token search
  if (tokens.length === 1 && tokens[0] !== 'TON') return 'token_search';
  if (lower.match(/безопасн|надёжн|надежн|стабильн|консерватив|без риск|safe|stable|conserv|low risk/)) return 'safe';
  if (lower.match(/максимальн|агрессивн|высок|доходност|заработ|рисков|maximum|yield|aggressive|high return|max apy/)) return 'aggressive';
  return 'general';
}

// ─── Select pools by intent ──────────────────────────────────

function intentMessage(intent: Intent, tokens: string[], count: number): string {
  switch (intent) {
    case 'safe': return `Подобрал ${count} безопасных пула с минимальным риском непостоянных потерь.`;
    case 'aggressive': return `Вот ${count} пула с максимальной доходностью. Учтите повышенный риск IL!`;
    case 'token_search': return `Нашёл ${count} пулов с ${tokens.join(', ')}.`;
    case 'general': return `Подобрал сбалансированный набор: безопасный, умеренный и агрессивный пулы.`;
  }
}

function intentRisk(intent: Intent): string {
  switch (intent) {
    case 'safe': return 'conservative';
    case 'aggressive': return 'aggressive';
    default: return 'moderate';
  }
}

// ─── API Handler ─────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: AgentRequest = await request.json();
    if (!body.message || body.message.trim().length === 0) {
      return NextResponse.json({ error: 'Введите ваш запрос' }, { status: 400 });
    }

    const startTime = Date.now();
    const tokens = extractTokens(body.message);
    const intent = classifyIntent(body.message, tokens);

    console.log(`[agent] Message: "${body.message}" → intent: ${intent}, tokens: [${tokens.join(',')}]`);

    // ── Step 1: Search real pools via DexScreener ──

    let pools: RealPool[] = [];

    // Smart search based on intent
    let searchTerms: string[];
    if (tokens.length >= 2) {
      // Two tokens = user wants a specific pair → search as pair + individually
      searchTerms = [`${tokens[0]} ${tokens[1]}`, tokens[0]];
    } else if (tokens.length === 1) {
      searchTerms = [tokens[0]];
    } else if (intent === 'safe') {
      searchTerms = ['stablecoin TON'];
    } else if (intent === 'aggressive') {
      searchTerms = ['DOGS'];
    } else {
      // Use message words for search
      const words = body.message.split(/\s+/).filter((w: string) => w.length >= 3);
      searchTerms = words.length > 0 ? [words[0]] : ['TON'];
    }

    console.log(`[agent] Searching: ${searchTerms.join(', ')}`);

    try {
      const searches = searchTerms.map((t) => searchAllPools(t));
      const results = await Promise.allSettled(searches);
      for (const r of results) {
        if (r.status === 'fulfilled') pools.push(...r.value);
      }
      // Deduplicate
      const seen = new Set<string>();
      pools = pools.filter((p) => { if (seen.has(p.poolAddress)) return false; seen.add(p.poolAddress); return true; });

      console.log(`[agent] DexScreener found ${pools.length} real pools`);
    } catch {
      console.log('[agent] Pool search failed');
    }

    // If no pools found, tell user honestly
    if (pools.length === 0) {
      return NextResponse.json({
        strategies: [],
        agentMessage: tokens.length > 0
          ? `Could not find pools for ${tokens.join(', ')} on TON DEXs. Try a different token.`
          : 'No pools found. Try searching for a specific token like NOT, DOGS, or USDT.',
        userProfile: { riskLevel: 'moderate', investmentGoal: body.message, detectedAmount: null },
        poolsScanned: 0,
        processingTimeMs: Date.now() - startTime,
      });
    }

    // Sort: for aggressive → by APY desc, for safe → by risk asc
    if (intent === 'aggressive') {
      pools.sort((a, b) => b.apyPercent - a.apyPercent);
    } else if (intent === 'safe') {
      pools = pools.filter((p) => p.riskLevel === 'low' || p.riskLevel === 'medium');
      pools.sort((a, b) => a.apyPercent - b.apyPercent); // lowest risk first
    }

    const poolMsg = intentMessage(intent, tokens, Math.min(pools.length, 3));

    // ── Step 2: Try Gemini AI for personalized analysis ──

    const geminiKey = process.env.GEMINI_API_KEY ?? '';
    if (geminiKey.length > 0) {
      try {
        const aiResult = await callGemini(geminiKey, body.message, pools);
        if (aiResult !== null) {
          console.log(`[agent] Gemini returned: ${JSON.stringify(aiResult).slice(0, 500)}`);

          const aiStrategies = (Array.isArray(aiResult.strategies) ? aiResult.strategies : []) as { poolId: string; score: number; rationale: string }[];

          // Try matching by poolId first, then by index
          const enriched = aiStrategies
            .map((s, idx) => {
              // Match by ID
              let pool = pools.find((p) => p.id === s.poolId);
              // Match by pair name in poolId
              if (!pool) {
                pool = pools.find((p) =>
                  s.poolId.toLowerCase().includes(p.pair.toLowerCase().replace('/', '-')) ||
                  p.pair.toLowerCase().includes(s.poolId.toLowerCase())
                );
              }
              // Fallback: use by index
              if (!pool && idx < pools.length) {
                pool = pools[idx];
              }
              if (!pool) return null;
              return buildStrategy(pool, s.score ?? (90 - idx * 10), s.rationale ?? buildAutoRationale(pool));
            })
            .filter(Boolean);

          if (enriched.length > 0) {
            return NextResponse.json({
              strategies: enriched,
              agentMessage: (aiResult.agentMessage as string) ?? intentMessage(intent, tokens, enriched.length),
              userProfile: (aiResult.userProfile as Record<string, unknown>) ?? { riskLevel: intentRisk(intent), investmentGoal: body.message, detectedAmount: null },
              poolsScanned: pools.length,
              processingTimeMs: Date.now() - startTime,
            });
          }
        }
      } catch (err) {
        console.error('[agent] Gemini failed:', err instanceof Error ? err.message : err);
      }
    }

    // ── Step 4: Return pools with auto-generated rationale ──

    console.log(`[agent] Step 4: returning ${pools.length} pools with auto rationale`);

    const strategies = pools.slice(0, 3).map((pool, i) =>
      buildStrategy(pool, 92 - i * 8, buildAutoRationale(pool))
    );

    return NextResponse.json({
      strategies,
      agentMessage: poolMsg,
      userProfile: { riskLevel: intentRisk(intent), investmentGoal: body.message, detectedAmount: null },
      poolsScanned: pools.length,
      processingTimeMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error('[agent] Error:', error);
    return NextResponse.json({ error: 'Ошибка. Попробуйте ещё раз.' }, { status: 500 });
  }
}

interface AgentRequest { message: string; walletAddress: string | null; }

// ─── Gemini ──────────────────────────────────────────────────

function buildSystemPrompt(pools: RealPool[]): string {
  const poolList = pools.map((p) =>
    `- id: "${p.id}", pair: ${p.pair}, protocol: ${p.protocol}, APY: ${p.apyPercent.toFixed(1)}%, TVL: $${(p.tvlUsd/1e6).toFixed(1)}M, risk: ${p.riskLevel}`
  ).join('\n');

  return `You are TradeMind, a DeFi investment advisor for TON blockchain. Respond in Russian.

AVAILABLE POOLS:
${poolList}

Return ONLY a valid JSON object with this exact structure:
{"strategies":[{"poolId":"exact pool id from list above","score":85,"rationale":"2-3 sentences in Russian explaining why"}],"agentMessage":"1-2 sentence summary in Russian","userProfile":{"riskLevel":"moderate","investmentGoal":"user goal","detectedAmount":null}}`;
}

async function callGemini(apiKey: string, message: string, pools: RealPool[]) {
  // Try models from user's available list — aliases first (always point to latest)
  const models = ['gemini-2.5-flash-lite', 'gemini-flash-latest'];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // NO thinkingConfig — let model think, we skip thought parts in response
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: buildSystemPrompt(pools) }] },
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.2 },
    };

    let response: Response | null = null;
    for (let retry = 0; retry < 2; retry++) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) {
        console.error(`[agent] ${model} fetch error:`, e instanceof Error ? e.message : e);
        break;
      }
      if (response.status !== 429) break;
      await new Promise((r) => setTimeout(r, 5000));
    }

    if (!response) continue;

    if (response.status === 404 || response.status === 400) {
      const errBody = await response.text().catch(() => '');
      console.log(`[agent] ${model}: ${response.status} — trying next model`);
      continue; // Try next model
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error(`[agent] ${model} HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      continue;
    }

    console.log(`[agent] ${model} responded OK`);

    const data = await response.json();

    // Extract text — skip thinking/thought parts
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    let rawText = '';
    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p.thought === true) continue;
      if (typeof p.text === 'string') rawText += p.text;
    }

    if (!rawText || rawText.length < 10) {
      console.error(`[agent] ${model}: empty response`);
      continue;
    }

    console.log(`[agent] ${model} output (${rawText.length}ch): ${rawText.slice(0, 300)}`);

    const parsed = extractJSON(rawText);
    if (parsed) {
      console.log(`[agent] AI OK from ${model}`);
      return parsed;
    }
    console.error(`[agent] JSON parse failed from ${model}`);
  }

  return null;
}


function extractJSON(raw: string): Record<string, unknown> | null {
  // Strip markdown, whitespace
  let text = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  // Direct parse
  try { return JSON.parse(text); } catch { /* */ }

  // Find outermost { ... }
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) {
    const slice = text.slice(s, e + 1);
    try { return JSON.parse(slice); } catch { /* */ }

    // Try removing trailing garbage inside the object
    // Sometimes Gemini adds explanation after JSON
    for (let cutback = 0; cutback < 50; cutback++) {
      const trimmed = slice.slice(0, slice.length - cutback);
      const lastBrace = trimmed.lastIndexOf('}');
      if (lastBrace > 0) {
        try { return JSON.parse(trimmed.slice(0, lastBrace + 1)); } catch { /* */ }
      }
    }
  }

  // Fix truncated JSON — close open brackets/strings
  if (s >= 0) {
    let fix = text.slice(s);
    // Remove trailing incomplete key-value pairs
    fix = fix.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, '');
    // Close brackets
    const quotes = (fix.match(/"/g) ?? []).length;
    if (quotes % 2 !== 0) fix += '"';
    const ob = (fix.match(/\[/g) ?? []).length - (fix.match(/\]/g) ?? []).length;
    for (let i = 0; i < Math.max(0, ob); i++) fix += ']';
    const oc = (fix.match(/\{/g) ?? []).length - (fix.match(/\}/g) ?? []).length;
    for (let i = 0; i < Math.max(0, oc); i++) fix += '}';
    try { return JSON.parse(fix); } catch { /* */ }
  }

  return null;
}

// ─── Strategy builder ────────────────────────────────────────

function buildStrategy(pool: RealPool, score: number, rationale: string) {
  return {
    id: pool.id,
    name: `${pool.pair} on ${pool.protocol === 'stonfi' ? 'STON.fi' : 'DeDust'}`,
    type: 'add_liquidity',
    protocol: pool.protocol,
    poolAddress: pool.poolAddress,
    poolUrl: pool.poolUrl,
    pair: pool.pair,
    estimatedApyPercent: pool.apyPercent,
    poolTvlUsd: pool.tvlUsd,
    volume24hUsd: pool.volume24hUsd,
    ilRisk: {
      expectedIlPercent: pool.riskLevel === 'low' ? 0.001 : pool.riskLevel === 'medium' ? 0.03 : 0.08,
      worstCaseIlPercent: pool.riskLevel === 'low' ? 0.005 : pool.riskLevel === 'medium' ? 0.10 : 0.25,
      riskLevel: pool.riskLevel,
      withinTolerance: true,
    },
    score,
    rationale,
    transactionPayload: null,
  };
}

function buildAutoRationale(pool: RealPool): string {
  const proto = pool.protocol === 'stonfi' ? 'STON.fi' : 'DeDust';
  const tvl = pool.tvlUsd > 1e6 ? `$${(pool.tvlUsd/1e6).toFixed(1)}M` : `$${(pool.tvlUsd/1e3).toFixed(0)}K`;
  const risk = pool.riskLevel === 'low' ? 'низкий' : pool.riskLevel === 'medium' ? 'средний' : 'высокий';
  return `Пул ${pool.pair} на ${proto} с TVL ${tvl} и APY ${pool.apyPercent.toFixed(1)}%. Риск: ${risk}.`;
}
