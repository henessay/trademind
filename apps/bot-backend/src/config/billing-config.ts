/**
 * Billing Configuration
 *
 * All monetization flows through Telegram Stars (XTR) exclusively.
 * No direct fiat gateways or cryptocurrency payments allowed.
 * See CLAUDE.md §10.
 *
 * Telegram Stars pricing:
 * - Users buy Stars via in-app purchases (Apple/Google)
 * - Bot receives Stars for digital goods/services
 * - Bot owner can convert Stars to Toncoin via @BotFather
 *
 * @see https://core.telegram.org/bots/payments-stars
 */

// ─── Currency ────────────────────────────────────────────────

/** Telegram Stars currency code — the only payment method allowed */
export const STARS_CURRENCY = 'XTR' as const;

/** Provider token for Stars (empty string per Telegram docs) */
export const STARS_PROVIDER_TOKEN = '' as const;

// ─── Subscription Tiers ──────────────────────────────────────

export interface SubscriptionTier {
  /** Unique tier identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Description shown in the invoice */
  readonly description: string;

  /** Price in Telegram Stars */
  readonly priceStars: number;

  /** Subscription period in days */
  readonly periodDays: number;

  /** Features unlocked by this tier */
  readonly features: readonly string[];

  /** Whether this tier supports recurring payments */
  readonly supportsRecurring: boolean;
}

export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  {
    id: 'pro_weekly',
    name: 'TradeMind Pro — Неделя',
    description: 'Расширенная аналитика пулов, приоритетные MCP-запросы, подробные IL-отчёты.',
    priceStars: 50,
    periodDays: 7,
    features: [
      'Расширенная аналитика STON.fi и DeDust',
      'Приоритетные MCP-запросы',
      'Подробные отчёты по непостоянным потерям',
      'До 20 стратегий вместо 5',
    ],
    supportsRecurring: false,
  },
  {
    id: 'pro_monthly',
    name: 'TradeMind Pro — Месяц',
    description: 'Полный доступ к аналитике на месяц. Выгоднее недельной подписки.',
    priceStars: 150,
    periodDays: 30,
    features: [
      'Всё из недельного плана',
      'Автоматические уведомления о рисках',
      'Экспорт стратегий в PDF',
    ],
    supportsRecurring: true,
  },
  {
    id: 'pro_annual',
    name: 'TradeMind Pro — Год',
    description: 'Максимальная экономия. Годовой доступ со всеми премиум-функциями.',
    priceStars: 1200,
    periodDays: 365,
    features: [
      'Всё из месячного плана',
      'Персональный AI-профиль с глубоким анализом',
      'Ранний доступ к новым функциям',
    ],
    supportsRecurring: true,
  },
] as const;

// ─── Terms & Conditions ──────────────────────────────────────

/**
 * URL to the recurring payment terms page.
 * REQUIRED by Telegram for subscriptions with recurring flag.
 * Must be publicly accessible and describe cancellation policy.
 *
 * @see https://core.telegram.org/api/subscriptions
 */
export const RECURRING_TERMS_URL =
  process.env['RECURRING_TERMS_URL'] ??
  'https://trademind.io/terms/recurring-payments';

/** General terms of service URL */
export const TERMS_OF_SERVICE_URL =
  process.env['TERMS_OF_SERVICE_URL'] ??
  'https://trademind.io/terms';

/** Privacy policy URL */
export const PRIVACY_POLICY_URL =
  process.env['PRIVACY_POLICY_URL'] ??
  'https://trademind.io/privacy';

// ─── Payment Support ─────────────────────────────────────────

/** Maximum refund window in days (per Telegram ToS) */
export const REFUND_WINDOW_DAYS = 14;

/** Support contact for payment disputes */
export const PAYMENT_SUPPORT_USERNAME = '@TradeMindSupport';

// ─── Helpers ─────────────────────────────────────────────────

export function getTierById(tierId: string): SubscriptionTier | null {
  return SUBSCRIPTION_TIERS.find((t) => t.id === tierId) ?? null;
}

export function getRecurringTiers(): readonly SubscriptionTier[] {
  return SUBSCRIPTION_TIERS.filter((t) => t.supportsRecurring);
}
