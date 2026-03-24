# Security Audit Skill — TradeMind

> **Роль**: Ты — внутренний аудитор безопасности проекта TradeMind.
> **Триггер**: Этот навык вызывается автоматически перед каждым коммитом
> через post-edit хук Claude Code и git pre-commit хук.
> **Область**: Все модули в `apps/` и `packages/`.

---

## Когда запускать

Аудит **обязателен** при модификации любого из этих критических модулей:

- `packages/identity-hub/` — шифрование профилей, TON Storage
- `apps/bot-backend/src/services/intent-engine.ts` — оркестратор стратегий
- `apps/bot-backend/src/modules/build-transaction-payload.ts` — диспетчер BOC
- `apps/bot-backend/src/modules/dedust-tx-builder.ts` — DeDust BOC (recipientAddress)
- `apps/bot-backend/src/modules/stonfi-tx-builder.ts` — STON.fi BOC (Router V2)
- `apps/bot-backend/src/services/monetization-service.ts` — биллинг Telegram Stars
- `packages/mcp-servers/*/src/` — внешние API-вызовы

---

## Проверка 1: Утечка Telegram ID во внешние API

**Правило**: Telegram ID, имя пользователя, номер телефона и адрес кошелька
**ЗАПРЕЩЕНО** передавать в MCP-серверы и любые внешние API.

MCP-серверы получают **только** анонимизированные финансовые параметры:
минимальный TVL, символы токенов, суммы, слиппадж.

**Автоматическая проверка**:
```bash
grep -rn "telegramId\|telegram_id\|chatId\|chat_id\|userId\|user_id\|userName\|user_name\|phone" \
  --include="*.ts" --include="*.tsx" \
  packages/mcp-servers/
```
Должен вернуть **пустой результат**.

**Ручная проверка**:
Открой каждый вызов `callStonfiTool()` и `callDedustTool()` в `mcp-client.ts`.
Убедись, что в объектах `params` нет ни одного поля с пользовательским идентификатором.

---

## Проверка 2: Запрет типа `any`

**Правило**: Тип `any` запрещён во всём проекте. Используй `unknown` + type guards.
Особенно критично в модулях работы с BOC, профилями и MCP-ответами.

**Автоматическая проверка**:
```bash
grep -rn ":\s*any\b" --include="*.ts" --include="*.tsx" apps/ packages/
```
Должен вернуть **пустой результат**. Допустимых исключений нет.

---

## Проверка 3: Обработка ошибок TON RPC

**Правило**: Каждый асинхронный вызов к `TonClient4`, `TonProvider`,
`TonStorageClient` и любому сетевому API должен:

1. Быть обёрнут в `try/catch`
2. Иметь таймаут (через `withTimeout` или `AbortController`)
3. Логировать ошибку без раскрытия внутренних данных пользователю
4. **Никогда** не отправлять ошибочную транзакцию — при ошибке вернуть
   человекочитаемое сообщение, а не пустой/невалидный BOC

**Ручная проверка**:
- `ton-provider.ts`: `withTimeout()` и `withRetry()` применяются ко всем методам
- `ton-storage-client.ts`: `uploadBag()` и `downloadBag()` имеют retry + exponential backoff
- `profile-manager.ts`: `loadProfile()` корректно обрабатывает `BAG_NOT_FOUND`

---

## Проверка 4: Безопасность BOC (Bag of Cells)

**Правило**: Все транзакционные билдеры должны:

1. Валидировать **все** входные адреса через `Address.parse()` перед использованием
2. Проверять, что суммы > 0 (нет нулевых/отрицательных транзакций)
3. Ограничивать слиппадж верхним пределом `ABSOLUTE_MAX_SLIPPAGE` (5%)
4. Никогда не хардкодить адреса кошельков пользователей

**Автоматическая проверка**:
```bash
grep -c "ABSOLUTE_MAX_SLIPPAGE\|validateSlippage\|validateSwapParams" \
  apps/bot-backend/src/modules/stonfi-tx-builder.ts \
  apps/bot-backend/src/modules/dedust-tx-builder.ts \
  apps/bot-backend/src/modules/build-transaction-payload.ts
```

**Ручная проверка**:
- `dedust-tx-builder.ts`: `swapParams.recipientAddress` корректно кодируется в BOC,
  `has_custom_recipient` выставлен только когда `recipientAddress !== senderAddress`
- `stonfi-tx-builder.ts`: реферальный адрес берётся из конфига

---

## Проверка 5: Изоляция приватных ключей

**Правило**: Бэкенд и MCP-серверы **НИКОГДА** не получают доступ к приватным ключам.
Подпись транзакций — исключительно на стороне клиента через TON Connect.

**Автоматическая проверка**:
```bash
grep -rn "privateKey\|secretKey\|mnemonic\|seed_phrase\|keyPair" \
  --include="*.ts" --include="*.tsx" \
  apps/bot-backend/src/ packages/mcp-servers/
```
Должен вернуть **пустой результат**.

---

## Проверка 6: Монетизация только через Telegram Stars

**Правило**: Все продажи цифровых услуг/подписок маршрутизируются
**исключительно** через Telegram Stars (XTR). Прямые фиатные шлюзы
и оплата криптовалютой — **ЗАПРЕЩЕНЫ**.

**Автоматическая проверка**:
```bash
grep -rn "currency" --include="*.ts" \
  apps/bot-backend/src/services/monetization-service.ts \
  apps/bot-backend/src/modules/payment-commands.ts
```
Все совпадения должны содержать `'XTR'` или `STARS_CURRENCY`.

---

## Проверка 7: recurring_terms_url для подписок

**Правило**: Каждый recurring-инвойс **обязан** содержать `recurring_terms_url`
со ссылкой на страницу условий рекуррентных платежей (требование Telegram).

**Автоматическая проверка**:
```bash
grep -c "RECURRING_TERMS_URL\|recurring_terms_url\|recurringTermsUrl" \
  apps/bot-backend/src/services/monetization-service.ts \
  apps/bot-backend/src/config/billing-config.ts
```
Обе файла должны содержать ссылки.

---

## Проверка 8: Команда /paysupport

**Правило**: Бот **обязан** обрабатывать `/paysupport` для разрешения
споров по платежам и возвратов (требование Telegram Developer ToS).

Команда должна показывать: статус подписки, историю платежей,
возможность возврата, контакт поддержки.

**Автоматическая проверка**:
```bash
grep -c "paysupport\|handlePaySupportCommand" \
  apps/bot-backend/src/modules/payment-commands.ts
```

---

## Проверка 9: Криптография Identity Hub

**Правило**:
- AES-256-GCM: рандомный IV для каждого шифрования (`randomBytes`)
- Ключ через HKDF, не напрямую из подписи (`hkdfExtract`/`hkdfExpand`)
- Auth tag проверяется при расшифровке (`setAuthTag`/`getAuthTag`)
- Данные в TON Storage верифицируются по SHA-256

**Автоматическая проверка**:
```bash
grep -c "randomBytes" packages/identity-hub/src/crypto/profile-cipher.ts
grep -c "hkdfExtract\|hkdfExpand" packages/identity-hub/src/crypto/key-derivation.ts
grep -c "setAuthTag\|getAuthTag" packages/identity-hub/src/crypto/profile-cipher.ts
```
Все счётчики должны быть > 0.

---

## Сводная команда аудита

```bash
bash scripts/security-audit.sh
```

Если хотя бы одна проверка провалена — **коммит блокируется**.

---

## Действия при обнаружении нарушения

1. **Остановить коммит** — не фиксировать код с нарушениями
2. **Описать нарушение** — файл, строка, тип проблемы
3. **Предложить исправление** — конкретный diff
4. **Повторить аудит** — после исправления запустить скрипт заново
