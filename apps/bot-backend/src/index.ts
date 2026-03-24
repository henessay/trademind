/**
 * TradeMind Bot Backend — Entry Point
 *
 * Bootstraps the IntentEngine and connects to MCP servers.
 * In production, this also starts the grammY Telegram bot.
 */

// ─── Services ────────────────────────────────────────────────
export { IntentEngine, IntentEngineError } from './services/intent-engine.js';
export type { IntentEngineErrorCode } from './services/intent-engine.js';

// ─── Modules ─────────────────────────────────────────────────
export {
  buildSwapPayload,
  buildAddLiquidityPayload,
  buildStrategyTransaction,
} from './modules/build-transaction-payload.js';

// ─── Types ───────────────────────────────────────────────────
export type {
  Strategy,
  TransactionPayload,
  TransactionChain,
  SwapParams,
  AddLiquidityParams,
  IntentEngineResult,
  McpToolClient,
  RiskLevel,
  UserProfile,
  NormalizedPool,
} from './types/intent.js';

// ─── Config ──────────────────────────────────────────────────
export {
  MAX_SLIPPAGE,
  ABSOLUTE_MAX_SLIPPAGE,
  DEDUST_FACTORY_ADDR,
  STONFI_ROUTER_ADDR,
} from './config/engine-config.js';

// ─── Monetization ────────────────────────────────────────────
export { MonetizationService } from './services/monetization-service.js';
export type { SubscriptionStore, TelegramBotApi } from './services/monetization-service.js';

export {
  handleSubscribeCommand,
  handlePaySupportCommand,
  handleTierSelection,
  handleRefundCallback,
  handlePreCheckoutQuery,
  handleSuccessfulPayment,
} from './modules/payment-commands.js';

export type {
  InvoiceParams,
  CreatedInvoice,
  UserSubscription,
  RefundRequest,
  RefundResult,
  PaymentSupportContext,
} from './types/billing.js';

export {
  SUBSCRIPTION_TIERS,
  STARS_CURRENCY,
  RECURRING_TERMS_URL,
} from './config/billing-config.js';
