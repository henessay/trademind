#!/usr/bin/env bash
#
# TradeMind Security Audit Script
#
# Runs all 9 security checks defined in .claude/skills/security-audit.md.
# Exit code 0 = all checks passed, non-zero = audit failed (blocks commit).
#
# Usage:
#   bash scripts/security-audit.sh          # Full audit (all 9 checks)
#   bash scripts/security-audit.sh --full   # Same as above
#   bash scripts/security-audit.sh --quick  # Quick checks only (1,2,5 — fastest)
#
# Called automatically by:
#   - .claude/settings.json post-edit hook (--quick on critical file changes)
#   - .claude/settings.json pre-commit hook (--full before every commit)
#   - .git/hooks/pre-commit (--full as git-level safety net)

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No color

# ─── State ────────────────────────────────────────────────────
FAILURES=0
CHECKS_RUN=0
MODE="${1:---full}"

# Navigate to repo root
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")/..")"

# ─── Helpers ──────────────────────────────────────────────────

pass() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  echo -e "  ${GREEN}✓ PASS${NC}: $1"
}

fail() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  FAILURES=$((FAILURES + 1))
  echo -e "  ${RED}✗ FAIL${NC}: $1"
  if [ -n "${2:-}" ]; then
    echo -e "    ${RED}→ $2${NC}"
  fi
}

header() {
  echo -e "\n${CYAN}[$1]${NC} $2"
}

# ─── Check 1: Telegram ID leaks into MCP servers ─────────────

check_telegram_id_leaks() {
  header "1/9" "Telegram ID leaks into MCP servers"

  local result
  result=$(grep -rn "telegramId\|telegram_id\|chatId\|chat_id\|userId\|user_id\|userName\|user_name\|phone_number" \
    --include="*.ts" --include="*.tsx" \
    packages/mcp-servers/ 2>/dev/null || true)

  if [ -z "$result" ]; then
    pass "No Telegram IDs in MCP server code"
  else
    fail "Telegram ID found in MCP server code" "$result"
  fi
}

# ─── Check 2: No 'any' type ──────────────────────────────────

check_no_any_type() {
  header "2/9" "TypeScript 'any' type prohibition"

  local result
  result=$(grep -rn ":\s*any\b" --include="*.ts" --include="*.tsx" \
    apps/ packages/ 2>/dev/null || true)

  if [ -z "$result" ]; then
    pass "No 'any' types found"
  else
    fail "Found 'any' type usage" "$result"
  fi
}

# ─── Check 3: Async error handling ───────────────────────────

check_async_error_handling() {
  header "3/9" "Async error handling (try/catch in async functions)"

  local warnings=0

  for f in $(grep -rl "async " --include="*.ts" \
    apps/bot-backend/src/ packages/ 2>/dev/null || true); do

    # Skip test files and type files
    if echo "$f" | grep -qE "(test|spec|\.d\.ts)"; then continue; fi

    local async_count try_count
    async_count=$(grep -c "async " "$f" 2>/dev/null || echo 0)
    try_count=$(grep -c "try {" "$f" 2>/dev/null || echo 0)

    if [ "$try_count" -eq 0 ] && [ "$async_count" -gt 0 ]; then
      echo -e "    ${YELLOW}⚠ WARNING${NC}: $f has $async_count async function(s) but no try/catch"
      warnings=$((warnings + 1))
    fi
  done

  if [ "$warnings" -eq 0 ]; then
    pass "All async files have error handling"
  else
    fail "$warnings file(s) with async but no try/catch"
  fi
}

# ─── Check 4: BOC security (slippage validation) ─────────────

check_boc_security() {
  header "4/9" "BOC transaction security (slippage caps)"

  local builders=(
    "apps/bot-backend/src/modules/stonfi-tx-builder.ts"
    "apps/bot-backend/src/modules/dedust-tx-builder.ts"
    "apps/bot-backend/src/modules/build-transaction-payload.ts"
  )

  local all_ok=true
  for f in "${builders[@]}"; do
    if [ ! -f "$f" ]; then continue; fi
    local count
    count=$(grep -c "ABSOLUTE_MAX_SLIPPAGE\|validateSlippage\|validateSwapParams\|validateLiquidityParams" "$f" 2>/dev/null || echo 0)
    if [ "$count" -eq 0 ]; then
      fail "No slippage validation in $f"
      all_ok=false
    fi
  done

  if $all_ok; then
    pass "All BOC builders have slippage validation"
  fi
}

# ─── Check 5: No private keys ────────────────────────────────

check_no_private_keys() {
  header "5/9" "Private key isolation"

  local result
  result=$(grep -rn "privateKey\|secretKey\|mnemonic\|seed_phrase\|keyPair" \
    --include="*.ts" --include="*.tsx" \
    apps/bot-backend/src/ packages/mcp-servers/ 2>/dev/null || true)

  if [ -z "$result" ]; then
    pass "No private key references in backend/MCP code"
  else
    fail "Private key reference found" "$result"
  fi
}

# ─── Check 6: Stars-only monetization ─────────────────────────

check_stars_only() {
  header "6/9" "Telegram Stars (XTR) exclusive monetization"

  local billing_file="apps/bot-backend/src/config/billing-config.ts"
  if [ ! -f "$billing_file" ]; then
    pass "Billing config not present (no monetization module yet)"
    return
  fi

  local xtr_count
  xtr_count=$(grep -rc "XTR\|STARS_CURRENCY" \
    apps/bot-backend/src/services/monetization-service.ts \
    apps/bot-backend/src/modules/payment-commands.ts \
    apps/bot-backend/src/config/billing-config.ts 2>/dev/null \
    | awk -F: '{s+=$NF} END{print s+0}')

  if [ "$xtr_count" -gt 0 ]; then
    pass "XTR/STARS_CURRENCY enforced ($xtr_count references)"
  else
    fail "No XTR currency enforcement found"
  fi
}

# ─── Check 7: Recurring terms URL ────────────────────────────

check_recurring_terms() {
  header "7/9" "Recurring payment terms URL"

  local monetization="apps/bot-backend/src/services/monetization-service.ts"
  if [ ! -f "$monetization" ]; then
    pass "Monetization service not present yet"
    return
  fi

  local count
  count=$(grep -rc "RECURRING_TERMS_URL\|recurring_terms_url\|recurringTermsUrl" \
    "$monetization" \
    apps/bot-backend/src/config/billing-config.ts 2>/dev/null \
    | awk -F: '{s+=$NF} END{print s+0}')

  if [ "$count" -ge 2 ]; then
    pass "recurring_terms_url present ($count references)"
  else
    fail "Missing recurring_terms_url (found $count, need ≥2)"
  fi
}

# ─── Check 8: /paysupport command ────────────────────────────

check_paysupport() {
  header "8/9" "/paysupport command handler"

  local commands="apps/bot-backend/src/modules/payment-commands.ts"
  if [ ! -f "$commands" ]; then
    pass "Payment commands not present yet"
    return
  fi

  local count
  count=$(grep -c "paysupport\|handlePaySupportCommand\|PaySupport" "$commands" 2>/dev/null || echo 0)

  if [ "$count" -ge 3 ]; then
    pass "/paysupport handler present ($count references)"
  else
    fail "/paysupport handler missing or incomplete (found $count, need ≥3)"
  fi
}

# ─── Check 9: Crypto safety in Identity Hub ──────────────────

check_crypto_safety() {
  header "9/9" "Identity Hub cryptography"

  local cipher="packages/identity-hub/src/crypto/profile-cipher.ts"
  local keyder="packages/identity-hub/src/crypto/key-derivation.ts"
  local all_ok=true

  if [ ! -f "$cipher" ] || [ ! -f "$keyder" ]; then
    pass "Identity Hub crypto modules not present yet"
    return
  fi

  # Check random IV
  local iv_count
  iv_count=$(grep -c "randomBytes" "$cipher" 2>/dev/null || echo 0)
  if [ "$iv_count" -eq 0 ]; then
    fail "No randomBytes in profile-cipher.ts (IV must be random)"
    all_ok=false
  fi

  # Check HKDF
  local hkdf_count
  hkdf_count=$(grep -c "hkdfExtract\|hkdfExpand" "$keyder" 2>/dev/null || echo 0)
  if [ "$hkdf_count" -eq 0 ]; then
    fail "No HKDF in key-derivation.ts (key must be derived via HKDF)"
    all_ok=false
  fi

  # Check auth tag
  local tag_count
  tag_count=$(grep -c "setAuthTag\|getAuthTag" "$cipher" 2>/dev/null || echo 0)
  if [ "$tag_count" -eq 0 ]; then
    fail "No auth tag verification in profile-cipher.ts"
    all_ok=false
  fi

  if $all_ok; then
    pass "Random IV ($iv_count), HKDF ($hkdf_count), auth tag ($tag_count) — all present"
  fi
}

# ─── Main ─────────────────────────────────────────────────────

echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   TradeMind Security Audit  [$MODE]   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"

if [ "$MODE" = "--quick" ]; then
  # Quick mode: fastest checks only (for post-edit hook)
  check_telegram_id_leaks
  check_no_any_type
  check_no_private_keys
else
  # Full mode: all 9 checks (for pre-commit hook)
  check_telegram_id_leaks
  check_no_any_type
  check_async_error_handling
  check_boc_security
  check_no_private_keys
  check_stars_only
  check_recurring_terms
  check_paysupport
  check_crypto_safety
fi

# ─── Summary ──────────────────────────────────────────────────

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo -e "${GREEN}═══ ALL $CHECKS_RUN CHECKS PASSED ═══${NC}"
  exit 0
else
  echo -e "${RED}═══ $FAILURES/$CHECKS_RUN CHECKS FAILED — COMMIT BLOCKED ═══${NC}"
  echo -e "${RED}Fix the issues above and run: bash scripts/security-audit.sh${NC}"
  exit 1
fi
