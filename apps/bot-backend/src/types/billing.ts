/**
 * Billing Types for TradeMind Monetization.
 *
 * All payments go through Telegram Stars (XTR) exclusively.
 * No `any` — see CLAUDE.md §5.
 */

// ─── Invoice ─────────────────────────────────────────────────

export interface InvoiceParams {
  /** Subscription tier ID (e.g., 'pro_monthly') */
  readonly tierId: string;

  /** Title shown in the payment dialog */
  readonly title: string;

  /** Description shown in the payment dialog */
  readonly description: string;

  /** Price in Telegram Stars */
  readonly priceStars: number;

  /** Unique payload to identify this invoice in webhook */
  readonly invoicePayload: string;

  /** Whether this is a recurring subscription */
  readonly isRecurring: boolean;

  /** URL to recurring payment terms (required if isRecurring=true) */
  readonly recurringTermsUrl: string | null;

  /** Photo URL for the invoice (optional) */
  readonly photoUrl: string | null;
}

export interface CreatedInvoice {
  /** Telegram invoice link (for sendInvoice or createInvoiceLink) */
  readonly invoiceLink: string;

  /** Payload that will be returned in successful_payment */
  readonly payload: string;

  /** Tier ID for tracking */
  readonly tierId: string;

  /** Timestamp of creation */
  readonly createdAt: string;
}

// ─── Payment Events ──────────────────────────────────────────

export interface PreCheckoutEvent {
  /** Telegram pre_checkout_query ID */
  readonly queryId: string;

  /** User's Telegram ID */
  readonly userId: number;

  /** Invoice payload (matches InvoiceParams.invoicePayload) */
  readonly invoicePayload: string;

  /** Currency code (always 'XTR') */
  readonly currency: string;

  /** Total amount in Stars */
  readonly totalAmount: number;
}

export interface SuccessfulPaymentEvent {
  /** User's Telegram ID */
  readonly userId: number;

  /** Invoice payload */
  readonly invoicePayload: string;

  /** Currency code (always 'XTR') */
  readonly currency: string;

  /** Total amount paid in Stars */
  readonly totalAmount: number;

  /** Telegram payment charge ID (for refunds) */
  readonly telegramPaymentChargeId: string;

  /** Provider payment charge ID */
  readonly providerPaymentChargeId: string;

  /** Whether this is a recurring payment */
  readonly isRecurring: boolean;

  /** Subscription expiry date (if recurring) */
  readonly subscriptionExpirationDate: number | null;
}

// ─── Subscription State ──────────────────────────────────────

export interface UserSubscription {
  /** User's Telegram ID */
  readonly userId: number;

  /** Active subscription tier ID */
  readonly tierId: string;

  /** ISO 8601 timestamp when subscription started */
  readonly startedAt: string;

  /** ISO 8601 timestamp when subscription expires */
  readonly expiresAt: string;

  /** Whether auto-renewal is active */
  readonly isRecurring: boolean;

  /** Telegram payment charge ID of the last payment */
  readonly lastPaymentChargeId: string;

  /** Subscription status */
  readonly status: SubscriptionStatus;
}

export type SubscriptionStatus =
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'refunded';

// ─── Refund ──────────────────────────────────────────────────

export interface RefundRequest {
  /** User's Telegram ID */
  readonly userId: number;

  /** Telegram payment charge ID to refund */
  readonly telegramPaymentChargeId: string;

  /** Reason for refund */
  readonly reason: string;

  /** ISO 8601 timestamp of request */
  readonly requestedAt: string;
}

export interface RefundResult {
  readonly success: boolean;
  readonly message: string;
}

// ─── Payment Support ─────────────────────────────────────────

export interface PaymentSupportContext {
  /** User's Telegram ID */
  readonly userId: number;

  /** Active subscription (null if none) */
  readonly subscription: UserSubscription | null;

  /** Recent payment history */
  readonly recentPayments: readonly PaymentRecord[];
}

export interface PaymentRecord {
  readonly chargeId: string;
  readonly tierId: string;
  readonly amountStars: number;
  readonly paidAt: string;
  readonly status: 'completed' | 'refunded';
}
