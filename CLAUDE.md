# CLAUDE.md — TradeMind: Autonomous DeFi Concierge on TON

> Этот файл загружается перед каждой сессией Claude Code.
> Он содержит архитектурные правила, стандарты кодирования и контекст проекта.

---

## 1. Парадигма разработки: EPIC

Всегда следуй циклу **Explore → Plan → Implement → Commit**:

| Фаза       | Описание                                                                                         |
|------------|--------------------------------------------------------------------------------------------------|
| **Explore**    | Изучи существующий код, зависимости, структуру и контекст задачи. Прочитай связанные файлы.   |
| **Plan**       | Сформулируй план: какие файлы затронуты, edge-cases, необходимые тесты. Используй Plan Mode перед написанием логики смарт-контрактов. |
| **Implement**  | Реализуй изменения строго по плану. Запускай линтер и тесты после каждого изменения.           |
| **Commit**     | Атомарный коммит в формате Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`). |

> **Правило:** Запрещается писать код бизнес-логики без предварительного прохождения фаз Explore и Plan.

---

## 2. Структура монорепозитория

```
trademind/
├── apps/
│   ├── telegram-mini-app/     # Клиент: React + Next.js 14 (Telegram Mini App)
│   └── bot-backend/           # Сервер: Node.js (IntentEngine, генерация BOC)
├── packages/
│   ├── mcp-servers/
│   │   ├── stonfi-server/     # MCP-сервер для STON.fi (Omniston, RxJS)
│   │   └── dedust-server/     # MCP-сервер для DeDust (TonClient4)
│   └── identity-hub/          # Криптографическое хранилище профилей (TON Storage)
├── docs/                      # Документация проекта
├── CLAUDE.md                  # ← Этот файл
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

---

## 3. Менеджер пакетов

- **Использовать только `pnpm`** для управления зависимостями и рабочими пространствами (workspaces).
- Команды запуска: `pnpm install`, `pnpm -r build`, `pnpm --filter <workspace> dev`.
- Запрещено использовать `npm` или `yarn`.

---

## 4. Обязательные библиотеки DEX

Для взаимодействия с децентрализованными биржами TON использовать **строго**:

| DEX      | Пакеты                                        | Назначение                                      |
|----------|-----------------------------------------------|-------------------------------------------------|
| STON.fi  | `@ston-fi/sdk`, `@ston-fi/api`, `@ston-fi/omniston-sdk` | Пулы, котировки, Omniston (Best Price Discovery) |
| DeDust   | `@dedust/sdk`                                 | Пулы, ликвидность, фабрика `MAINNET_FACTORY_ADDR` |

- Для подключения к сети TON: `@ton/ton` (TonClient4).
- Для MCP-серверов: `@modelcontextprotocol/sdk`.
- Для кошелька: `@tonconnect/ui-react`.

> **Запрещено:** использовать неофициальные обёртки или форки этих библиотек.

---

## 5. TypeScript: строгая типизация

- **Запрещено** использовать тип `any` в любом участке кода.
- В `tsconfig.json` обязательны: `"strict": true`, `"noImplicitAny": true`.
- Все интерфейсы, связанные с BOC, транзакциями и профилями, должны быть **строго типизированы**.
- Предпочтительно использовать `unknown` + type guards вместо `any`.

```typescript
// ❌ Запрещено
function processData(data: any): any { ... }

// ✅ Правильно
function processData(data: unknown): TransactionPayload { ... }
```

---

## 6. Стек технологий

| Слой       | Технологии                                                     |
|------------|----------------------------------------------------------------|
| **Клиент**     | React, Next.js 14 (App Router), @tonconnect/ui-react, Telegram WebApp CSS |
| **Бэкенд**     | Node.js, TypeScript, Dependency Injection                      |
| **Блокчейн**   | TON (TonClient4), BOC (Bag of Cells), TON Storage             |
| **DEX**        | STON.fi (Omniston, RxJS), DeDust (MAINNET_FACTORY_ADDR)       |
| **MCP**        | @modelcontextprotocol/sdk                                      |
| **Биллинг**    | Telegram Stars (XTR), Bot Payments API                         |

---

## 7. Архитектурные паттерны

- **Intent-Based Execution**: пользователь описывает намерение на естественном языке, система находит оптимальный путь исполнения.
- **Dependency Injection**: бэкенд строится на принципах DI для модульности и тестируемости.
- **Изоляция приватных ключей**: ИИ никогда не получает доступ к приватным ключам. BOC формируется на бэкенде, подписывается пользователем через TON Connect.
- **Анонимизация**: запросы к MCP-серверам содержат только финансовые параметры, без привязки к Telegram ID пользователя.

---

## 8. Команды сборки и разработки

```bash
# Установка зависимостей
pnpm install

# Сборка всех пакетов
pnpm -r build

# Запуск клиента (dev)
pnpm --filter telegram-mini-app dev

# Запуск бэкенда (dev)
pnpm --filter bot-backend dev

# Линтинг
pnpm -r lint

# Тесты
pnpm -r test
```

---

## 9. Правила коммитов

Формат: `<type>(<scope>): <description>`

- `feat(identity-hub): add RiskProfile encryption`
- `fix(mcp-stonfi): handle timeout on pool fetch`
- `refactor(intent-engine): extract strategy ranker`
- `docs(claude-md): update build commands`
- `chore(deps): bump @ston-fi/sdk to v3`

---

## 10. Безопасность

- Все асинхронные вызовы к TON RPC (`TonClient4`) должны иметь обработку ошибок и таймауты.
- Запрещена передача Telegram ID пользователя во внешние API.
- Критические модули (`IntentEngine`, `ProfileManager`, `buildTransactionPayload`) подлежат автоматическому аудиту через skill `security-audit.md`.
- Монетизация цифровых услуг — исключительно через Telegram Stars (XTR). Прямые фиатные шлюзы и оплата криптовалютой запрещены.
