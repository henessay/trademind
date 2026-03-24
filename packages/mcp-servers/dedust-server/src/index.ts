/**
 * MCP Server: DeDust
 *
 * A Model Context Protocol server providing TradeMind's IntentEngine
 * with DeDust DEX data and impermanent loss analytics:
 *
 * Tools:
 * - get_dedust_liquidity: Pool metrics via TonClient4 + MAINNET_FACTORY_ADDR
 * - analyze_impermanent_loss: Monte Carlo IL risk simulation
 *
 * Runs as a standalone stdio MCP server. All requests contain only
 * anonymized financial parameters — no user identifiers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  executeDedustLiquidity,
  formatLiquiditySummary,
  type DedustPoolDataSource,
} from './tools/get-dedust-liquidity.js';
import {
  executeImpermanentLossAnalysis,
  formatIlAnalysis,
} from './tools/analyze-impermanent-loss.js';
import { isValidLiquidityParams, isValidIlParams } from './types.js';

// ─── Schema Definitions ──────────────────────────────────────

const liquidityParamsSchema = {
  minTvlUsd: z.number().positive().optional()
    .describe('Minimum TVL in USD (default: 5000)'),
  poolType: z.enum(['volatile', 'stable', 'all']).optional()
    .describe('Pool type filter (default: "all")'),
  tokenSymbol: z.string().optional()
    .describe('Filter by token symbol (e.g., "TON", "USDT")'),
  limit: z.number().int().positive().max(100).optional()
    .describe('Maximum results (default: 20, max: 100)'),
  sortBy: z.enum(['tvl', 'volume', 'fees', 'apy']).optional()
    .describe('Sort field (default: "tvl")'),
};

const ilParamsSchema = {
  token0Symbol: z.string().min(1)
    .describe('First token symbol (e.g., "TON")'),
  token1Symbol: z.string().min(1)
    .describe('Second token symbol (e.g., "USDT")'),
  token0PriceUsd: z.number().positive()
    .describe('Current price of token0 in USD'),
  token1PriceUsd: z.number().positive()
    .describe('Current price of token1 in USD'),
  token0Volatility: z.number().min(0).max(10)
    .describe('Annualized volatility of token0 (e.g., 0.8 = 80%)'),
  token1Volatility: z.number().min(0).max(10)
    .describe('Annualized volatility of token1'),
  priceCorrelation: z.number().min(-1).max(1)
    .describe('Price correlation between tokens (-1 to 1)'),
  horizonDays: z.number().int().positive().max(365).optional()
    .describe('Analysis horizon in days (default: 30)'),
  simulationPaths: z.number().int().positive().max(10000).optional()
    .describe('Monte Carlo paths (default: 1000, max: 10000)'),
};

// ─── Server Factory ──────────────────────────────────────────

export function createDedustMcpServer(
  poolDataSource: DedustPoolDataSource,
): McpServer {
  const server = new McpServer({
    name: 'trademind-dedust',
    version: '0.1.0',
  });

  // ── Tool: get_dedust_liquidity ──

  server.tool(
    'get_dedust_liquidity',
    'Fetch DeDust liquidity pool metrics. Returns TVL, reserves, volume, fees, ' +
    'and estimated APY. Supports filtering by pool type (volatile/stable), ' +
    'token symbol, and minimum TVL. Uses TonClient4 and MAINNET_FACTORY_ADDR.',
    liquidityParamsSchema,
    async (params) => {
      try {
        if (!isValidLiquidityParams(params)) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Invalid parameters.' }],
          };
        }
        const pools = await executeDedustLiquidity(params, poolDataSource);
        const summary = formatLiquiditySummary(pools);
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

  // ── Tool: analyze_impermanent_loss ──

  server.tool(
    'analyze_impermanent_loss',
    'Monte Carlo simulation of impermanent loss risk for a token pair. ' +
    'Uses correlated geometric Brownian motion to model price divergence scenarios. ' +
    'Returns expected IL, 95th percentile worst case, risk classification, ' +
    'and whether the pool is suitable for conservative investors.',
    ilParamsSchema,
    async (params) => {
      try {
        if (!isValidIlParams(params)) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Invalid parameters.' }],
          };
        }
        const result = executeImpermanentLossAnalysis(params);
        const summary = formatIlAnalysis(result);
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
  poolDataSource: DedustPoolDataSource,
): Promise<void> {
  const server = createDedustMcpServer(poolDataSource);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP:DeDust] Server started on stdio');

  process.on('SIGINT', async () => {
    console.error('[MCP:DeDust] Shutting down...');
    await server.close();
    process.exit(0);
  });
}
