#!/usr/bin/env bash
#
# Installs git hooks for TradeMind.
# Run once after cloning the repository:
#
#   bash scripts/install-hooks.sh
#

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SOURCE="$REPO_ROOT/scripts/hooks"
HOOKS_TARGET="$REPO_ROOT/.git/hooks"

echo "Installing TradeMind git hooks..."

# Pre-commit hook
if [ -f "$HOOKS_SOURCE/pre-commit" ]; then
  cp "$HOOKS_SOURCE/pre-commit" "$HOOKS_TARGET/pre-commit"
  chmod +x "$HOOKS_TARGET/pre-commit"
  echo "  ✓ pre-commit hook installed"
else
  echo "  ✗ pre-commit hook source not found"
  exit 1
fi

echo ""
echo "Done! Security audit will run automatically before every commit."
echo "To run manually: bash scripts/security-audit.sh"
