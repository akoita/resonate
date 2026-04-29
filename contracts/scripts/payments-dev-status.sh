#!/usr/bin/env bash
# payments-dev-status.sh - inspect local payment developer setup.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ARTIFACT_FILE="${PAYMENT_DEV_ARTIFACT_PATH:-$PROJECT_ROOT/contracts/deployments/local-payments.json}"
RPC_URL="${RPC_URL:-http://localhost:8545}"
BACKEND_ENV="$PROJECT_ROOT/backend/.env"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required. Install with: sudo apt install jq"
  exit 1
fi

echo "=== Local Payment Dev Status ==="
echo ""

if CHAIN_ID_HEX=$(curl -sf "$RPC_URL" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  | jq -r '.result' 2>/dev/null); then
  CHAIN_ID=$(printf "%d" "$CHAIN_ID_HEX" 2>/dev/null || echo "unknown")
  echo -e "RPC:      ${GREEN}reachable${NC} ($RPC_URL)"
  echo "Chain:    $CHAIN_ID"
else
  echo -e "RPC:      ${RED}unreachable${NC} ($RPC_URL)"
  CHAIN_ID="unknown"
fi

if [[ -f "$ARTIFACT_FILE" ]]; then
  echo -e "Artifact: ${GREEN}$ARTIFACT_FILE${NC}"
  echo ""
  echo "Contracts:"
  jq -r '.contracts | to_entries[] | "  \(.key): \(.value)"' "$ARTIFACT_FILE"
  echo ""
  echo "Assets:"
  jq -r '.assets[] | "  \(.assetId) \(.symbol) decimals=\(.decimals) enabled=\(.enabled) token=\(.tokenAddress)"' "$ARTIFACT_FILE"
  echo ""
  echo "Funding:"
  jq -r '.funding.options[] | "  \(.assetId): \(.label) (\(.kind))"' "$ARTIFACT_FILE"
  echo ""
  echo "x402 local mode:"
  jq -r 'if .x402 then "  \(.x402.localMode) fallback=\(.x402.fallbackModes | join(","))" else "  (not configured)" end' "$ARTIFACT_FILE"
else
  echo -e "Artifact: ${YELLOW}missing${NC} ($ARTIFACT_FILE)"
  echo "Run: make payments-dev-up"
fi

echo ""
if [[ -f "$BACKEND_ENV" ]]; then
  echo "Backend payment env:"
  grep -E '^(PAYMENT_|X402_LOCAL_MODE)' "$BACKEND_ENV" 2>/dev/null | sed 's/^/  /' || echo "  (none)"
else
  echo "Backend payment env: (backend/.env missing)"
fi
