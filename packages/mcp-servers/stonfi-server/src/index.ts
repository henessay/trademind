/**
 * MCP Server: STON.fi
 *
 * A Model Context Protocol server that provides TradeMind's IntentEngine
 * with real-time access to STON.fi DEX data:
 *
 * Tools:
 * - get_stonfi_pools: Discover and filter liquidity pools (TVL, APY, volume)
 * - get_stonfi_quote: Best Price Discovery via Omniston reactive streams (RxJS)
 *
 * Runs as a standalone stdio MCP server. All requests contain only
 * anonymized financial parameters — no user identifiers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { executeStonfiPools, formatPoolsSummary } from './tools/get-stonfi-pools.js';
import { executeStonfiQuote, formatQuoteSummary } from './tools/get-stonfi-quote.js';
import type { StonfiPoolDataSource } from './tools/get-stonfi-pools.js';
import type { OmnistonTransport } from './lib/omniston-client.js';
import { isValidPoolsParams, isValidQuoteParams } from './types.js';

// ─── Schema Definitions ──────────────────────────────────────

const poolsParamsSchema = {
  minTvlUsd: z.number().positive().optional()
    .describe('Minimum TVL in USD (default: 10000)'),
  minApyPercent: z.number().min(0).optional()
    .describe('Minimum APY percent (default: 0)'),
  tokenSymbol: z.string().optional()
    .describe('Filter by token symbol (e.g., "TON", "USDT")'),
  limit: z.number().int().positive().max(100).optional()
    .describe('Maximum results (default: 20, max: 100)'),
  sortBy: z.enum(['tvl', 'apy', 'volume']).optional()
    .describe('Sort field (default: "tvl")'),
};

const quoteParamsSchema = {
  offerAssetAddress: z.string().min(1)
    .describe('Source token address (jetton master)'),
  askAssetAddress: z.string().min(1)
    .describe('Destination token address (jetton master)'),
  offerUnits: z.string().min(1)
    .describe('Amount to swap in source token minimal units'),
  maxSlippage: z.number().min(0).max(0.5).optional()
    .describe('Maximum slippage tolerance (default: 0.01 = 1%)'),
  timeoutMs: z.number().int().positive().max(30000).optional()
    .describe('Quote discovery timeout in ms (default: 10000)'),
};

// ─── Server Factory ──────────────────────────────────────────

export function createStonfiMcpServer(
  poolDataSource: StonfiPoolDataSource,
  omnistonTransport: OmnistonTransport,
): McpServer {
  const server = new McpServer({
    name: 'trademind-stonfi',
    version: '0.1.0',
  });

  // ── Tool: get_stonfi_pools ──

  server.tool(
    'get_stonfi_pools',
    'Fetch and filter STON.fi liquidity pools by TVL, APY, token symbol. ' +
    'Returns pool addresses, token pairs, TVL, APY, 24h volume, and fee rates.',
    poolsParamsSchema,
    async (params) => {
      try {
        if (!isValidPoolsParams(params)) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Invalid parameters.' }],
          };
        }
        const pools = await executeStonfiPools(params, poolDataSource);
        const summary = formatPoolsSummary(pools);
        return {
          content: [
            { type: 'text' as const, text: summary },
            { type: 'text' as const, text: JSON.stringify(pools, null, 2) },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // ── Tool: get_stonfi_quote ──

  server.tool(
    'get_stonfi_quote',
    'Best Price Discovery via STON.fi Omniston protocol using RxJS reactive streams. ' +
    'Aggregates quotes from multiple resolvers and returns the optimal exchange rate.',
    quoteParamsSchema,
    async (params) => {
      try {
        if (!isValidQuoteParams(params)) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Invalid parameters.' }],
          };
        }
        const result = await executeStonfiQuote(params, omnistonTransport);
        const summary = formatQuoteSummary(result);
        return {
          content: [
            { type: 'text' as const, text: summary },
            { type: 'text' as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ─── Main Entry Point ────────────────────────────────────────

export async function startServer(
  poolDataSource: StonfiPoolDataSource,
  omnistonTransport: OmnistonTransport,
): Promise<void> {
  const server = createStonfiMcpServer(poolDataSource, omnistonTransport);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP:STON.fi] Server started on stdio');

  process.on('SIGINT', async () => {
    console.error('[MCP:STON.fi] Shutting down...');
    await server.close();
    process.exit(0);
  });
}
