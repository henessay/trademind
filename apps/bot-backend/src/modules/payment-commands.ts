/**
 * Payment Commands — Telegram Bot Command Handlers
 *
 * Integrates MonetizationService with grammY bot framework:
 *
 * Commands:
 * - /subscribe  — Show available subscription tiers
 * - /paysupport — Payment support and refund requests (REQUIRED by Telegram ToS)
 *
 * Event handlers:
 * - pre_checkout_query  — Validate payment before charging
 * - successful_payment  — Process confirmed payment
 *
 * The /paysupport command is MANDATORY per Telegram Developer Terms of Service.
 * It must allow users to:
 * 1. View their current subscription status
 * 2. See recent payment history
 * 3. Request refunds for eligible payments
 * 4. Contact support for disputes
 *
 * @see https://core.telegram.org/bots/payments-stars
 */

import type { MonetizationService } from '../services/monetization-service.js';
import type {
  PreCheckoutEvent,
  SuccessfulPaymentEvent,
  UserSubscription,
  PaymentRecord,
} from '../types/billing.js';
import {
  SUBSCRIPTION_TIERS,
  RECURRING_TERMS_URL,
  PAYMENT_SUPPORT_USERNAME,
  REFUND_WINDOW_DAYS,
  STARS_CURRENCY,
} from '../config/billing-config.js';

/**
 * Abstract bot context interface — decouples from grammY.
 * In production, this wraps grammY's Context object.
 * In tests, this is a mock.
 */
export interface BotContext {
  readonly userId: number;
  readonly messageText: string;
  reply(text: string, options?: ReplyOptions): Promise<void>;
  replyWithInvoice(params: InvoiceMessageParams): Promise<void>;
}

interface ReplyOptions {
  readonly parse_mode?: 'HTML' | 'Markdown';
  readonly reply_markup?: ReplyMarkup;
}

interface ReplyMarkup {
  readonly inline_keyboard: readonly (readonly InlineButton[])[];
}

interface InlineButton {
  readonly text: string;
  readonly callback_data?: string;
  readonly url?: string;
  readonly pay?: boolean;
}

interface InvoiceMessageParams {
  readonly title: string;
  readonly description: string;
  readonly payload: string;
  readonly currency: string;
  readonly prices: readonly { readonly label: string; readonly amount: number }[];
  readonly provider_token: string;
  readonly subscription_period?: number;
}

// ─── Command Handlers ────────────────────────────────────────

/**
 * Handles /subscribe command.
 *
 * Shows available subscription tiers with inline buttons
 * that open the payment dialog.
 */
export async function handleSubscribeCommand(
  ctx: BotContext,
  monetization: MonetizationService,
): Promise<void> {
  // Check if already subscribed
  const isPremium = await monetization.isUserPremium(ctx.userId);

  if (isPremium) {
    await ctx.reply(
      '✅ <b>У вас уже есть активная подписка TradeMind Pro!</b>\n\n' +
      'Используйте /paysupport для управления подпиской.',
      { parse_mode: 'HTML' },
    );
    return;
  }

  // Build tier list
  const tierLines = SUBSCRIPTION_TIERS.map((tier) => {
    const recurring = tier.supportsRecurring ? ' (автопродление)' : '';
    const features = tier.features.slice(0, 2).join(', ');
    return (
      `⭐ <b>${tier.name}</b> — ${tier.priceStars} Stars${recurring}\n` +
      `  ${features}`
    );
  });

  const keyboard: readonly (readonly InlineButton[])[] = SUBSCRIPTION_TIERS.map(
    (tier) => [
      {
        text: `⭐ ${tier.name} — ${tier.priceStars} Stars`,
        callback_data: `subscribe:${tier.id}`,
      },
    ],
  );

  await ctx.reply(
    '🔮 <b>TradeMind Pro — Премиум аналитика</b>\n\n' +
    `${tierLines.join('\n\n')}\n\n` +
    'Выберите подходящий план:',
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    },
  );
}

/**
 * Handles subscription tier selection callback.
 * Creates and sends an invoice for the selected tier.
 */
export async function handleTierSelection(
  ctx: BotContext,
  tierId: string,
  monetization: MonetizationService,
): Promise<void> {
  try {
    const invoice = await monetization.createSubscriptionInvoice(
      ctx.userId,
      tierId,
    );

    const tier = SUBSCRIPTION_TIERS.find((t) => t.id === tierId);
    if (tier === undefined) {
      await ctx.reply('Тарифный план не найден.');
      return;
    }

    const invoiceParams: InvoiceMessageParams = {
      title: tier.name,
      description: tier.description,
      payload: invoice.payload,
      currency: STARS_CURRENCY,
      prices: [{ label: tier.name, amount: tier.priceStars }],
      provider_token: '',
    };

    // Add subscription period for recurring tiers
    if (tier.supportsRecurring) {
      await ctx.replyWithInvoice({
        ...invoiceParams,
        subscription_period: tier.periodDays * 24 * 60 * 60,
      });
    } else {
      await ctx.replyWithInvoice(invoiceParams);
    }

    // If recurring, inform about terms
    if (tier.supportsRecurring) {
      await ctx.reply(
        `ℹ️ Подписка с автопродлением. ` +
        `<a href="${RECURRING_TERMS_URL}">Условия рекуррентных платежей</a>.\n` +
        'Вы можете отменить автопродление в любое время через настройки Telegram.',
        { parse_mode: 'HTML' },
      );
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Ошибка';
    await ctx.reply(`Не удалось создать счёт: ${msg}`);
  }
}

// ─── /paysupport Command ─────────────────────────────────────

/**
 * Handles /paysupport command.
 *
 * REQUIRED by Telegram Developer Terms of Service.
 * Provides users with:
 * 1. Current subscription status
 * 2. Recent payment history
 * 3. Refund request option
 * 4. Support contact information
 *
 * @see https://core.telegram.org/bots/payments-stars
 */
export async function handlePaySupportCommand(
  ctx: BotContext,
  monetization: MonetizationService,
): Promise<void> {
  try {
    const supportCtx = await monetization.getPaymentSupportContext(ctx.userId);

    const sections: string[] = [];

    // ── Section 1: Subscription Status ──
    sections.push('💳 <b>Поддержка по платежам</b>');

    if (supportCtx.subscription !== null) {
      const sub = supportCtx.subscription;
      const statusEmoji = sub.status === 'active' ? '✅' : '❌';
      const expiresDate = new Date(sub.expiresAt).toLocaleDateString('ru-RU');
      const recurring = sub.isRecurring ? ' (автопродление)' : '';

      sections.push(
        `\n<b>Текущая подписка:</b>\n` +
        `${statusEmoji} ${sub.tierId}${recurring}\n` +
        `Действует до: ${expiresDate}`,
      );
    } else {
      sections.push(
        '\nУ вас нет активной подписки. ' +
        'Используйте /subscribe для оформления.',
      );
    }

    // ── Section 2: Payment History ──
    if (supportCtx.recentPayments.length > 0) {
      sections.push('\n<b>История платежей:</b>');

      for (const payment of supportCtx.recentPayments.slice(0, 5)) {
        const date = new Date(payment.paidAt).toLocaleDateString('ru-RU');
        const statusLabel = payment.status === 'completed'
          ? '✅' : '↩️ возврат';
        sections.push(
          `  ${date} — ${payment.amountStars} Stars (${payment.tierId}) ${statusLabel}`,
        );
      }
    }

    // ── Section 3: Actions ──
    const keyboard: (readonly InlineButton[])[] = [];

    // Refund button (only if there are completed payments)
    const refundablePayment = supportCtx.recentPayments.find(
      (p) => p.status === 'completed',
    );

    if (refundablePayment !== undefined) {
      keyboard.push([
        {
          text: '↩️ Запросить возврат',
          callback_data: `refund:${refundablePayment.chargeId}`,
        },
      ]);
    }

    // Terms link
    keyboard.push([
      {
        text: '📄 Условия рекуррентных платежей',
        url: RECURRING_TERMS_URL,
      },
    ]);

    // Support contact
    sections.push(
      `\n<b>Нужна помощь?</b>\n` +
      `Напишите ${PAYMENT_SUPPORT_USERNAME} для решения вопросов по платежам.\n` +
      `Возврат возможен в течение ${REFUND_WINDOW_DAYS} дней после оплаты.`,
    );

    await ctx.reply(sections.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Ошибка';
    await ctx.reply(
      `Не удалось загрузить данные о платежах: ${msg}\n` +
      `Обратитесь в ${PAYMENT_SUPPORT_USERNAME}.`,
    );
  }
}

/**
 * Handles refund callback from /paysupport inline button.
 */
export async function handleRefundCallback(
  ctx: BotContext,
  chargeId: string,
  monetization: MonetizationService,
): Promise<void> {
  const result = await monetization.processRefund({
    userId: ctx.userId,
    telegramPaymentChargeId: chargeId,
    reason: 'User requested via /paysupport',
    requestedAt: new Date().toISOString(),
  });

  if (result.success) {
    await ctx.reply(`✅ ${result.message}`);
  } else {
    await ctx.reply(
      `❌ ${result.message}\n` +
      `Обратитесь в ${PAYMENT_SUPPORT_USERNAME} для помощи.`,
    );
  }
}

// ─── Webhook Event Handlers ──────────────────────────────────

/**
 * Handles pre_checkout_query — validates payment before charge.
 * Must respond within 10 seconds.
 */
export async function handlePreCheckoutQuery(
  event: PreCheckoutEvent,
  monetization: MonetizationService,
): Promise<void> {
  await monetization.handlePreCheckout(event);
}

/**
 * Handles successful_payment — processes confirmed payment.
 * Updates subscription status and grants premium access.
 *
 * @returns Welcome message to send to the user
 */
export async function handleSuccessfulPayment(
  event: SuccessfulPaymentEvent,
  monetization: MonetizationService,
): Promise<string> {
  const subscription = await monetization.handleSuccessfulPayment(event);

  const expiresDate = new Date(subscription.expiresAt).toLocaleDateString('ru-RU');
  const recurring = subscription.isRecurring
    ? '\nАвтопродление активно. Отменить можно в настройках Telegram.'
    : '';

  return (
    `🎉 <b>Оплата получена! Спасибо!</b>\n\n` +
    `Подписка: ${subscription.tierId}\n` +
    `Действует до: ${expiresDate}` +
    `${recurring}\n\n` +
    `Премиум-функции активированы. Используйте /paysupport для управления подпиской.`
  );
}
