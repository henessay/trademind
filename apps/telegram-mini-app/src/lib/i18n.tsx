/**
 * i18n — Simple EN/RU translations for TradeMind.
 */

'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Lang = 'en' | 'ru';

const T = {
  // Header
  subtitle: { en: 'AI concierge for DeFi on TON', ru: 'ИИ-консьерж для DeFi на блокчейне TON' },

  // Wallet
  connectWallet: { en: 'Connect wallet', ru: 'Подключить кошелёк' },
  disconnectWallet: { en: 'Disconnect wallet', ru: 'Отключить кошелёк' },
  address: { en: 'Address', ru: 'Адрес' },

  // Dashboard
  walletBalance: { en: 'Wallet balance', ru: 'Баланс кошелька' },
  yourAssets: { en: 'Your assets', ru: 'Ваши активы' },
  refreshBalance: { en: 'Refresh balance', ru: 'Обновить баланс' },
  loadingWallet: { en: 'Loading wallet...', ru: 'Загружаю кошелёк...' },
  retry: { en: 'Retry', ru: 'Повторить' },
  error: { en: 'Error', ru: 'Ошибка' },
  loadError: { en: 'Failed to load wallet data', ru: 'Не удалось загрузить данные кошелька' },

  // Token strategy prompt
  wantStrategy: { en: 'Find a strategy for', ru: 'Хотите подобрать стратегию для токена' },
  findStrategy: { en: 'Find strategy', ru: 'Подобрать стратегию' },
  cancel: { en: 'Cancel', ru: 'Отмена' },

  // Intent input
  askAI: { en: 'Ask AI', ru: 'Спросите ИИ' },
  orAskAI: { en: 'Or ask AI', ru: 'Или спросите ИИ' },
  placeholder: { en: 'Describe your investment goal...', ru: 'Опишите вашу инвестиционную цель...' },
  suggestSafe: { en: 'Invest safely', ru: 'Вложить безопасно' },
  suggestMax: { en: 'Maximum yield', ru: 'Максимальная доходность' },
  suggestTon: { en: 'Where to invest 100 TON?', ru: 'Куда вложить 100 TON?' },

  // Strategy
  estYield: { en: 'Estimated yield', ru: 'Расчётная доходность' },
  showDetails: { en: 'Show details', ru: 'Показать детали' },
  hideDetails: { en: 'Hide details', ru: 'Скрыть детали' },
  pair: { en: 'Pair', ru: 'Пара' },
  poolTvl: { en: 'Pool TVL', ru: 'TVL пула' },
  volume24h: { en: '24h Volume', ru: 'Объём 24ч' },
  ilRisk: { en: 'Impermanent loss risk', ru: 'Риск непост. потерь' },
  expectedIl: { en: 'Expected IL', ru: 'Ожидаемый IL' },
  strategyScore: { en: 'Strategy score', ru: 'Оценка стратегии' },
  aiAnalysis: { en: 'AI Analysis', ru: 'Анализ ИИ' },

  // Strategy list
  aiRecommendations: { en: 'AI Recommendations', ru: 'Рекомендации ИИ' },
  analyzing: { en: 'Analyzing...', ru: 'Анализирую...' },
  aiSearching: { en: 'AI is searching liquidity pools...', ru: 'ИИ анализирует пулы ликвидности...' },
  tryAgain: { en: 'Try again', ru: 'Попробовать снова' },
  refreshStrategies: { en: 'Refresh strategies', ru: 'Обновить стратегии' },
  pools: { en: 'pools', ru: 'пулов' },

  // Navigation
  backToWallet: { en: 'Back to wallet', ru: 'Назад к кошельку' },
  askQuestion: { en: 'Ask AI a question', ru: 'Задайте вопрос ИИ' },
  refineQuery: { en: 'Refine your query', ru: 'Уточнить запрос' },

  // Risk levels
  conservative: { en: 'Conservative', ru: 'Консервативный' },
  moderate: { en: 'Moderate', ru: 'Умеренный' },
  aggressive: { en: 'Aggressive', ru: 'Агрессивный' },

  // Not connected
  connectPrompt: { en: 'Connect your wallet to see balance and get personalized AI strategies', ru: 'Подключите кошелёк, чтобы увидеть баланс и получить персональные стратегии от ИИ' },

  // Footer
  noKeyAccess: { en: 'We never access your private keys.', ru: 'Мы никогда не получаем доступ к вашим ключам.' },

  // Agent query for token
  findStrategyFor: { en: 'Find the best strategy for token', ru: 'Подбери лучшую стратегию для токена' },
} as const;

type TKey = keyof typeof T;

// ─── Context ─────────────────────────────────────────────────

interface I18nCtx {
  lang: Lang;
  toggle: () => void;
  t: (key: TKey) => string;
}

const I18nContext = createContext<I18nCtx>({
  lang: 'en',
  toggle: () => {},
  t: (key) => T[key]?.en ?? key,
});

export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const [lang, setLang] = useState<Lang>('en');

  const toggle = useCallback(() => {
    setLang((prev) => (prev === 'en' ? 'ru' : 'en'));
  }, []);

  const t = useCallback(
    (key: TKey): string => T[key]?.[lang] ?? key,
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, toggle, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
