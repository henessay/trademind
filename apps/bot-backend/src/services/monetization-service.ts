/**
 * MonetizationService — Telegram Stars Billing Engine
 *
 * Manages the complete payment lifecycle for TradeMind premium features:
 *
 * 1. Invoice creation (one-time and recurring subscriptions)
 * 2. Pre-checkout validation (answerPreCheckoutQuery)
 * 3. Successful payment processing (update user subscription)
 * 4. Refund handling (refundStarPayment)
 *
 * ALL payments use Telegram Stars (XTR) exclusively.
 * No fiat gateways or crypto payments. See CLAUDE.md §10.
 *
 * Recurring payments:
 * - Enabled via the `isRecurring` flag on the invoice
 * - REQUIRES `recurring_terms_url` parameter per Telegram ToS
 * - Telegram handles auto-renewal; we receive webhooks
 * - User can cancel via Telegram's subscription management
 *
 * @see https://core.telegram.org/bots/payments-stars
 * @see https://core.telegram.org/api/subscriptions
 */

import type {
  InvoiceParams,
  CreatedInvoice,
  PreCheckoutEvent,
  SuccessfulPaymentEvent,
  UserSubscription,
  RefundRequest,
  RefundResult,
  PaymentSupportContext,
  PaymentRecord,
} from '../types/billing.js';
import {
  STARS_CURRENCY,
  STARS_PROVIDER_TOKEN,
  RECURRING_TERMS_URL,
  REFUND_WINDOW_DAYS,
  getTierById,
  type SubscriptionTier,
} from '../config/billing-config.js';

// ─── Storage Interface (DI) ─────────────────────────────────

/**
 * Abstract persistence layer for subscription data.
 * In production: PostgreSQL / Redis / Identity Hub.
 * In tests: in-memory mock.
 */
export interface SubscriptionStore {
  getSubscription(userId: number): Promise<UserSubscription | null>;
  saveSubscription(subscription: UserSubscription): Promise<void>;
  updateSubscriptionStatus(
    userId: number,
    status: UserSubscription['status'],
  ): Promise<void>;
  getPaymentHistory(userId: number, limit: number): Promise<readonly PaymentRecord[]>;
  savePaymentRecord(record: PaymentRecord & { readonly userId: number }): Promise<void>;
}

/**
 * Abstract Telegram Bot API interface.
 * Wraps grammY's api methods for testability.
 */
export interface TelegramBotApi {
  createInvoiceLink(params: TelegramInvoiceLinkParams): Promise<string>;
  answerPreCheckoutQuery(queryId: string, ok: boolean, errorMessage?: string): Promise<void>;
  refundStarPayment(userId: number, telegramPaymentChargeId: string): Promise<boolean>;
}

interface TelegramInvoiceLinkParams {
  readonly title: string;
  readonly description: string;
  readonly payload: string;
  readonly currency: string;
  readonly prices: readonly { readonly label: string; readonly amount: number }[];
  readonly provider_token: string;
  readonly subscription_period?: number;
  readonly photo_url?: string;
}

// ─── MonetizationService ─────────────────────────────────────

export class MonetizationService {
  private readonly store: SubscriptionStore;
  private readonly botApi: TelegramBotApi;

  constructor(store: SubscriptionStore, botApi: TelegramBotApi) {
    this.store = store;
    this.botApi = botApi;
  }

  // ── Invoice Creation ─────────────────────────────────────

  /**
   * Creates an invoice link for a subscription tier.
   *
   * For recurring subscriptions:
   * - Sets `subscription_period` to the tier's period in seconds
   * - The `recurring_terms_url` is passed via the invoice payload
   *   (Telegram requires this URL to be shown to the user before
   *    they agree to recurring charges)
   *
   * @param userId - Telegram user ID (for payload tracking)
   * @param tierId - Subscription tier to purchase
   * @returns Created invoice with link and metadata
   *
   * @throws Error if tier not found or invoice creation fails
   */
  async createSubscriptionInvoice(
    userId: number,
    tierId: string,
  ): Promise<CreatedInvoice> {
    const tier = getTierById(tierId);
    if (tier === null) {
      throw new Error(`Unknown subscription tier: "${tierId}"`);
    }

    // Build unique payload for webhook identification
    const invoicePayload = buildInvoicePayload(userId, tier);

    const params = buildInvoiceParams(tier, invoicePayload);

    // Create the invoice via Telegram Bot API
    const invoiceLinkParams: TelegramInvoiceLinkParams = {
      title: params.title,
      description: params.description,
      payload: params.invoicePayload,
      currency: STARS_CURRENCY,
      prices: [{ label: tier.name, amount: tier.priceStars }],
      provider_token: STARS_PROVIDER_TOKEN,
    };

    // Add subscription period for recurring payments
    // Telegram requires period in seconds
    if (params.isRecurring && tier.supportsRecurring) {
      invoiceLinkParams = {
        ...invoiceLinkParams,
        subscription_period: tier.periodDays * 24 * 60 * 60,
      };
    }

    if (params.photoUrl !== null) {
      invoiceLinkParams = {
        ...invoiceLinkParams,
        photo_url: params.photoUrl,
      };
    }

    try {
      const link = await this.botApi.createInvoiceLink(invoiceLinkParams);

      return {
        invoiceLink: link,
        payload: invoicePayload,
        tierId: tier.id,
        createdAt: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to create invoice for tier "${tierId}": ${msg}`);
    }
  }

  /**
   * Creates a direct invoice link for sharing (e.g., via inline button).
   * Uses createInvoiceLink which returns a URL the user can click.
   */
  async createShareableInvoiceLink(
    userId: number,
    tierId: string,
  ): Promise<string> {
    const invoice = await this.createSubscriptionInvoice(userId, tierId);
    return invoice.invoiceLink;
  }

  // ── Pre-Checkout Validation ──────────────────────────────

  /**
   * Handles pre_checkout_query from Telegram.
   *
   * Called BEFORE payment is charged. We must respond within 10 seconds.
   * Here we verify:
   * - The invoice payload is valid
   * - The tier still exists and pricing hasn't changed
   * - The user doesn't already have an active subscription for this tier
   *
   * @param event - Pre-checkout event from Telegram
   * @returns true if approved, false with reason if rejected
   */
  async handlePreCheckout(
    event: PreCheckoutEvent,
  ): Promise<{ readonly approved: boolean; readonly reason: string | null }> {
    // Validate currency is Stars
    if (event.currency !== STARS_CURRENCY) {
      await this.botApi.answerPreCheckoutQuery(
        event.queryId,
        false,
        'Оплата возможна только через Telegram Stars.',
      );
      return { approved: false, reason: 'Invalid currency' };
    }

    // Parse and validate the invoice payload
    const parsed = parseInvoicePayload(event.invoicePayload);
    if (parsed === null) {
      await this.botApi.answerPreCheckoutQuery(
        event.queryId,
        false,
        'Недействительный счёт. Попробуйте создать новый.',
      );
      return { approved: false, reason: 'Invalid payload' };
    }

    // Verify tier exists
    const tier = getTierById(parsed.tierId);
    if (tier === null) {
      await this.botApi.answerPreCheckoutQuery(
        event.queryId,
        false,
        'Этот тарифный план больше недоступен.',
      );
      return { approved: false, reason: 'Tier not found' };
    }

    // Verify price hasn't changed
    if (tier.priceStars !== event.totalAmount) {
      await this.botApi.answerPreCheckoutQuery(
        event.queryId,
        false,
        'Цена изменилась. Пожалуйста, создайте новый счёт.',
      );
      return { approved: false, reason: 'Price mismatch' };
    }

    // All checks passed — approve the checkout
    await this.botApi.answerPreCheckoutQuery(event.queryId, true);
    return { approved: true, reason: null };
  }

  // ── Successful Payment Processing ────────────────────────

  /**
   * Handles successful_payment message from Telegram.
   *
   * Called AFTER payment is confirmed. Updates the user's subscription
   * status in the store and grants access to premium features.
   *
   * For recurring payments, `subscriptionExpirationDate` is set by Telegram
   * and indicates when the next renewal will occur.
   *
   * @param event - Successful payment event
   * @returns Updated subscription state
   */
  async handleSuccessfulPayment(
    event: SuccessfulPaymentEvent,
  ): Promise<UserSubscription> {
    const parsed = parseInvoicePayload(event.invoicePayload);
    const tierId = parsed?.tierId ?? 'unknown';
    const tier = getTierById(tierId);

    const now = new Date();
    const periodMs = (tier?.periodDays ?? 30) * 24 * 60 * 60 * 1000;

    const expiresAt = event.subscriptionExpirationDate !== null
      ? new Date(event.subscriptionExpirationDate * 1000).toISOString()
      : new Date(now.getTime() + periodMs).toISOString();

    const subscription: UserSubscription = {
      userId: event.userId,
      tierId,
      startedAt: now.toISOString(),
      expiresAt,
      isRecurring: event.isRecurring,
      lastPaymentChargeId: event.telegramPaymentChargeId,
      status: 'active',
    };

    // Persist subscription
    await this.store.saveSubscription(subscription);

    // Record payment
    await this.store.savePaymentRecord({
      userId: event.userId,
      chargeId: event.telegramPaymentChargeId,
      tierId,
      amountStars: event.totalAmount,
      paidAt: now.toISOString(),
      status: 'completed',
    });

    return subscription;
  }

  // ── Refund Processing ────────────────────────────────────

  /**
   * Processes a refund request.
   *
   * Uses Telegram's refundStarPayment API to return Stars to the user.
   * Per Telegram Developer ToS, refunds should be processed promptly.
   *
   * @param request - Refund request with charge ID
   * @returns Success/failure with message
   */
  async processRefund(request: RefundRequest): Promise<RefundResult> {
    // Check refund window
    const requestDate = new Date(request.requestedAt);
    const daysSinceRequest = Math.floor(
      (Date.now() - requestDate.getTime()) / (24 * 60 * 60 * 1000),
    );

    if (daysSinceRequest > REFUND_WINDOW_DAYS) {
      return {
        success: false,
        message: `Возврат возможен в течение ${REFUND_WINDOW_DAYS} дней после оплаты.`,
      };
    }

    try {
      const refunded = await this.botApi.refundStarPayment(
        request.userId,
        request.telegramPaymentChargeId,
      );

      if (refunded) {
        // Update subscription status
        await this.store.updateSubscriptionStatus(request.userId, 'refunded');

        return {
          success: true,
          message: 'Возврат выполнен. Stars будут зачислены на ваш баланс.',
        };
      }

      return {
        success: false,
        message: 'Не удалось выполнить возврат. Обратитесь в поддержку.',
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Ошибка при возврате: ${msg}`,
      };
    }
  }

  // ── Subscription Queries ─────────────────────────────────

  /**
   * Checks if a user has an active premium subscription.
   */
  async isUserPremium(userId: number): Promise<boolean> {
    const sub = await this.store.getSubscription(userId);
    if (sub === null) return false;
    if (sub.status !== 'active') return false;
    return new Date(sub.expiresAt) > new Date();
  }

  /**
   * Gets full payment support context for /paysupport command.
   */
  async getPaymentSupportContext(
    userId: number,
  ): Promise<PaymentSupportContext> {
    const subscription = await this.store.getSubscription(userId);
    const recentPayments = await this.store.getPaymentHistory(userId, 10);

    return {
      userId,
      subscription,
      recentPayments,
    };
  }
}

// ─── Payload Helpers ─────────────────────────────────────────

/**
 * Builds a structured invoice payload string.
 * Format: trademind:{tierId}:{userId}:{timestamp}
 *
 * NOTE: No sensitive data (wallet address, etc.) goes into the payload.
 * The userId here is Telegram's own ID — it's safe to include since
 * it stays within the Telegram ecosystem and never reaches external MCP APIs.
 */
function buildInvoicePayload(userId: number, tier: SubscriptionTier): string {
  const timestamp = Date.now();
  return `trademind:${tier.id}:${userId}:${timestamp}`;
}

interface ParsedPayload {
  readonly tierId: string;
  readonly userId: number;
  readonly timestamp: number;
}

function parseInvoicePayload(payload: string): ParsedPayload | null {
  const parts = payload.split(':');
  if (parts.length !== 4) return null;
  if (parts[0] !== 'trademind') return null;

  const tierId = parts[1];
  const userId = parseInt(parts[2], 10);
  const timestamp = parseInt(parts[3], 10);

  if (Number.isNaN(userId) || Number.isNaN(timestamp)) return null;

  return { tierId, userId, timestamp };
}

function buildInvoiceParams(
  tier: SubscriptionTier,
  invoicePayload: string,
): InvoiceParams {
  return {
    tierId: tier.id,
    title: tier.name,
    description: tier.description,
    priceStars: tier.priceStars,
    invoicePayload,
    isRecurring: tier.supportsRecurring,
    recurringTermsUrl: tier.supportsRecurring ? RECURRING_TERMS_URL : null,
    photoUrl: null,
  };
}
