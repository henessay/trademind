# TradeMind — Setup для Windows (PowerShell)
# Запустите этот скрипт из корня проекта:
#   cd trademind
#   .\scripts\setup-windows.ps1

Write-Host "`n=== TradeMind Setup for Windows ===" -ForegroundColor Cyan

# ─── Шаг 1: Проверка Node.js ─────────────────────────────────
Write-Host "`n[1/4] Проверяю Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  Node.js не найден! Установите с https://nodejs.org (v20+)" -ForegroundColor Red
    exit 1
}

# ─── Шаг 2: Установка pnpm ───────────────────────────────────
Write-Host "`n[2/4] Устанавливаю pnpm..." -ForegroundColor Yellow
try {
    $pnpmVersion = pnpm --version 2>$null
    Write-Host "  pnpm уже установлен: v$pnpmVersion" -ForegroundColor Green
} catch {
    Write-Host "  Устанавливаю pnpm через npm..." -ForegroundColor Yellow
    npm install -g pnpm@9
    $pnpmVersion = pnpm --version
    Write-Host "  pnpm установлен: v$pnpmVersion" -ForegroundColor Green
}

# ─── Шаг 3: Установка зависимостей ───────────────────────────
Write-Host "`n[3/4] Устанавливаю зависимости (pnpm install)..." -ForegroundColor Yellow
pnpm install

# ─── Шаг 4: Установка git hooks ──────────────────────────────
Write-Host "`n[4/4] Устанавливаю git pre-commit hook..." -ForegroundColor Yellow

$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) {
    $repoRoot = Get-Location
}

$hookSource = Join-Path $repoRoot "scripts" "hooks" "pre-commit"
$hookTarget = Join-Path $repoRoot ".git" "hooks" "pre-commit"

if (Test-Path $hookSource) {
    Copy-Item $hookSource $hookTarget -Force
    Write-Host "  Git pre-commit hook установлен" -ForegroundColor Green
} else {
    Write-Host "  Файл хука не найден: $hookSource" -ForegroundColor Yellow
}

# ─── Готово ───────────────────────────────────────────────────
Write-Host "`n=== Установка завершена! ===" -ForegroundColor Green
Write-Host @"

Запуск проекта:
  pnpm --filter bot-backend dev        # Бэкенд
  pnpm --filter telegram-mini-app dev  # Фронтенд

Аудит безопасности (нужен Git Bash или WSL):
  bash scripts/security-audit.sh

"@ -ForegroundColor White
