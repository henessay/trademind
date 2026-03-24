# TradeMind — Autonomous DeFi Concierge on TON

## Быстрый старт

### Требования

- **Node.js** ≥ 20 — [скачать](https://nodejs.org/)
- **Git** — [скачать](https://git-scm.com/)

### Windows (PowerShell)

```powershell
# 1. Распаковать архив (или склонировать репозиторий)
cd trademind

# 2. Установить pnpm (если не установлен)
npm install -g pnpm@9

# 3. Установить зависимости
pnpm install

# 4. Или запустить всё одной командой:
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

### macOS / Linux

```bash
cd trademind
npm install -g pnpm@9
pnpm install
bash scripts/install-hooks.sh
```

### Запуск

```bash
# Бэкенд (IntentEngine + MonetizationService)
pnpm --filter bot-backend dev

# Фронтенд (Telegram Mini App)
pnpm --filter telegram-mini-app dev
```

### Security Audit

```bash
# Linux / macOS / Git Bash on Windows:
bash scripts/security-audit.sh

# Windows (PowerShell / CMD) — без bash:
node scripts/security-audit.mjs

# Quick mode (только критические проверки):
node scripts/security-audit.mjs --quick
```

## Структура проекта

```
trademind/
├── apps/
│   ├── telegram-mini-app/     # React + Next.js 14 + @tonconnect/ui-react
│   └── bot-backend/           # IntentEngine + BOC builders + MonetizationService
├── packages/
│   ├── identity-hub/          # ProfileManager + AES-256-GCM + TON Storage
│   └── mcp-servers/
│       ├── stonfi-server/     # MCP: Omniston RxJS, get_stonfi_quote
│       └── dedust-server/     # MCP: TonClient4, IL Monte Carlo
├── scripts/
│   ├── security-audit.sh      # Bash: 9 security checks
│   ├── security-audit.mjs     # Node.js: same checks, cross-platform
│   ├── setup-windows.ps1      # Windows setup script
│   └── install-hooks.sh       # Git hooks installer
├── .claude/
│   ├── skills/security-audit.md  # Claude Code audit skill
│   └── settings.json             # Hooks configuration
├── CLAUDE.md                  # Agent memory / project rules
└── pnpm-workspace.yaml
```

## Лицензия

Proprietary. All rights reserved.
