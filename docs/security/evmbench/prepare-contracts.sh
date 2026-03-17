#!/usr/bin/env bash
# prepare-contracts.sh — Package Resonate Solidity contracts for evmbench upload
#
# Usage: ./docs/security/evmbench/prepare-contracts.sh
# Output: docs/security/evmbench/resonate-contracts.zip

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OUTPUT_FILE="$SCRIPT_DIR/resonate-contracts.zip"

echo "📦 Packaging Resonate contracts for evmbench..."
echo "   Project root: $PROJECT_ROOT"

# Remove previous archive if exists
rm -f "$OUTPUT_FILE"

# Create zip with production contracts and build config
cd "$PROJECT_ROOT/contracts"
zip -r "$OUTPUT_FILE" \
  src/core/StemNFT.sol \
  src/core/StemMarketplaceV2.sol \
  src/aa/KernelFactory.sol \
  src/aa/UniversalSigValidator.sol \
  src/modules/TransferValidator.sol \
  src/interfaces/ISplitsMain.sol \
  src/interfaces/ITransferValidator.sol \
  foundry.toml \
  2>/dev/null || true

# Include remappings if present
if [ -f remappings.txt ]; then
  zip -j "$OUTPUT_FILE" remappings.txt 2>/dev/null || true
fi

echo ""
echo "✅ Archive created: $OUTPUT_FILE"
echo "   Contents:"
unzip -l "$OUTPUT_FILE" | tail -n +4 | head -n -2
echo ""
echo "📤 Upload this file to:"
echo "   • Hosted:     https://paradigm.xyz/evmbench"
echo "   • Self-hosted: http://127.0.0.1:3000 (if running locally)"
