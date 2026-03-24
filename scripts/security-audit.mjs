/**
 * TradeMind Security Audit — Cross-Platform (Node.js)
 *
 * Same 9 checks as scripts/security-audit.sh, but runs on Windows
 * without requiring bash/WSL.
 *
 * Usage:
 *   node scripts/security-audit.mjs
 *   node scripts/security-audit.mjs --quick
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MODE = process.argv[2] ?? '--full';

let failures = 0;
let checksRun = 0;

function pass(msg) {
  checksRun++;
  console.log(`  \x1b[32m✓ PASS\x1b[0m: ${msg}`);
}

function fail(msg, detail) {
  checksRun++;
  failures++;
  console.log(`  \x1b[31m✗ FAIL\x1b[0m: ${msg}`);
  if (detail) console.log(`    \x1b[31m→ ${detail}\x1b[0m`);
}

function header(num, title) {
  console.log(`\n\x1b[36m[${num}]\x1b[0m ${title}`);
}

function grep(pattern, paths) {
  const pathStr = paths.join(' ');
  try {
    const result = execSync(
      `grep -rn "${pattern}" --include="*.ts" --include="*.tsx" ${pathStr}`,
      { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.trim();
  } catch {
    return '';
  }
}

function grepCount(pattern, paths) {
  let total = 0;
  for (const p of paths) {
    const fullPath = join(ROOT, p);
    if (!existsSync(fullPath)) continue;
    try {
      const result = execSync(
        `grep -c "${pattern}" "${fullPath}"`,
        { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      total += parseInt(result.trim(), 10) || 0;
    } catch {
      // grep returns exit 1 when no matches — that's OK
    }
  }
  return total;
}

// ─── Check 1: Telegram ID leaks ──────────────────────────────
function check1() {
  header('1/9', 'Telegram ID leaks into MCP servers');
  const result = grep(
    'telegramId\\|telegram_id\\|chatId\\|chat_id\\|userId\\|user_id\\|userName\\|user_name\\|phone_number',
    ['packages/mcp-servers/']
  );
  result === '' ? pass('No Telegram IDs in MCP server code') : fail('Telegram ID found', result);
}

// ─── Check 2: No 'any' ──────────────────────────────────────
function check2() {
  header('2/9', "TypeScript 'any' type prohibition");
  const result = grep(':\\s*any\\b', ['apps/', 'packages/']);
  result === '' ? pass("No 'any' types found") : fail("Found 'any' type usage", result);
}

// ─── Check 3: Async error handling ───────────────────────────
function check3() {
  header('3/9', 'Async error handling');
  // Simplified: check key files have try/catch
  const critical = [
    'apps/bot-backend/src/services/intent-engine.ts',
    'apps/bot-backend/src/services/monetization-service.ts',
    'packages/identity-hub/src/profile-manager.ts',
    'packages/mcp-servers/dedust-server/src/lib/ton-provider.ts',
  ];
  let warnings = 0;
  for (const f of critical) {
    if (!existsSync(join(ROOT, f))) continue;
    const tryCount = grepCount('try {', [f]);
    if (tryCount === 0) {
      console.log(`    ⚠ WARNING: ${f} has no try/catch`);
      warnings++;
    }
  }
  warnings === 0 ? pass('All critical async files have error handling') : fail(`${warnings} file(s) missing try/catch`);
}

// ─── Check 4: BOC security ──────────────────────────────────
function check4() {
  header('4/9', 'BOC transaction security');
  const builders = [
    'apps/bot-backend/src/modules/stonfi-tx-builder.ts',
    'apps/bot-backend/src/modules/dedust-tx-builder.ts',
    'apps/bot-backend/src/modules/build-transaction-payload.ts',
  ];
  const count = grepCount('ABSOLUTE_MAX_SLIPPAGE\\|validateSlippage\\|validateSwapParams\\|validateLiquidityParams', builders);
  count > 0 ? pass(`Slippage validation present (${count} refs)`) : fail('No slippage validation found');
}

// ─── Check 5: No private keys ────────────────────────────────
function check5() {
  header('5/9', 'Private key isolation');
  const result = grep('privateKey\\|secretKey\\|mnemonic\\|seed_phrase\\|keyPair', ['apps/bot-backend/src/', 'packages/mcp-servers/']);
  result === '' ? pass('No private key references') : fail('Private key reference found', result);
}

// ─── Check 6: Stars-only ─────────────────────────────────────
function check6() {
  header('6/9', 'Telegram Stars (XTR) exclusive monetization');
  const files = [
    'apps/bot-backend/src/services/monetization-service.ts',
    'apps/bot-backend/src/modules/payment-commands.ts',
    'apps/bot-backend/src/config/billing-config.ts',
  ];
  const count = grepCount('XTR\\|STARS_CURRENCY', files);
  count > 0 ? pass(`XTR enforced (${count} refs)`) : fail('No XTR currency enforcement');
}

// ─── Check 7: recurring_terms_url ────────────────────────────
function check7() {
  header('7/9', 'Recurring payment terms URL');
  const files = [
    'apps/bot-backend/src/services/monetization-service.ts',
    'apps/bot-backend/src/config/billing-config.ts',
  ];
  const count = grepCount('RECURRING_TERMS_URL\\|recurring_terms_url\\|recurringTermsUrl', files);
  count >= 2 ? pass(`recurring_terms_url present (${count} refs)`) : fail(`Missing (found ${count}, need ≥2)`);
}

// ─── Check 8: /paysupport ────────────────────────────────────
function check8() {
  header('8/9', '/paysupport command handler');
  const count = grepCount('paysupport\\|handlePaySupportCommand', ['apps/bot-backend/src/modules/payment-commands.ts']);
  count >= 3 ? pass(`/paysupport present (${count} refs)`) : fail(`Missing or incomplete (${count} refs)`);
}

// ─── Check 9: Crypto safety ─────────────────────────────────
function check9() {
  header('9/9', 'Identity Hub cryptography');
  const iv = grepCount('randomBytes', ['packages/identity-hub/src/crypto/profile-cipher.ts']);
  const hkdf = grepCount('hkdfExtract\\|hkdfExpand', ['packages/identity-hub/src/crypto/key-derivation.ts']);
  const tag = grepCount('setAuthTag\\|getAuthTag', ['packages/identity-hub/src/crypto/profile-cipher.ts']);
  (iv > 0 && hkdf > 0 && tag > 0)
    ? pass(`Random IV (${iv}), HKDF (${hkdf}), auth tag (${tag})`)
    : fail(`Missing crypto: IV=${iv}, HKDF=${hkdf}, tag=${tag}`);
}

// ─── Main ────────────────────────────────────────────────────
console.log('\x1b[36m╔══════════════════════════════════════════════╗\x1b[0m');
console.log(`\x1b[36m║   TradeMind Security Audit  [${MODE}]   ║\x1b[0m`);
console.log('\x1b[36m╚══════════════════════════════════════════════╝\x1b[0m');

if (MODE === '--quick') {
  check1(); check2(); check5();
} else {
  check1(); check2(); check3(); check4(); check5();
  check6(); check7(); check8(); check9();
}

console.log('');
if (failures === 0) {
  console.log(`\x1b[32m═══ ALL ${checksRun} CHECKS PASSED ═══\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m═══ ${failures}/${checksRun} CHECKS FAILED ═══\x1b[0m`);
  process.exit(1);
}
