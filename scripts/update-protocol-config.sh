#!/usr/bin/env bash
# update-protocol-config.sh - Parse Forge deployment output and update .env files
#
# Reads the latest DeployProtocol broadcast JSON and updates backend/.env
# and web/.env.local with StemNFT, StemMarketplaceV2, and TransferValidator
# contract addresses.
#
# Auto-detects chain ID from the local RPC so it works on both plain Anvil
# (chainId 31337) and forked Sepolia (chainId 11155111).
#
# Usage: ./scripts/update-protocol-config.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_ENV="$PROJECT_ROOT/backend/.env"
WEB_ENV_LOCAL="$PROJECT_ROOT/web/.env.local"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Updating Protocol Configuration ==="
echo ""

# Auto-detect chain ID from the local RPC
RPC_URL="${RPC_URL:-http://localhost:8545}"
echo "Detecting chain ID from $RPC_URL..."
CHAIN_ID_HEX=$(curl -sf "$RPC_URL" -X POST \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    | jq -r '.result' 2>/dev/null || echo "")

if [[ -n "$CHAIN_ID_HEX" && "$CHAIN_ID_HEX" != "null" ]]; then
    CHAIN_ID=$(printf "%d" "$CHAIN_ID_HEX" 2>/dev/null || echo "31337")
else
    CHAIN_ID="31337"
    echo -e "${YELLOW}Warning: Could not detect chain ID from RPC, defaulting to $CHAIN_ID${NC}"
fi
echo -e "${GREEN}Detected chain ID: $CHAIN_ID${NC}"
echo ""

BROADCAST_FILE="$PROJECT_ROOT/contracts/broadcast/DeployProtocol.s.sol/${CHAIN_ID}/run-latest.json"

# Check if broadcast file exists
if [[ ! -f "$BROADCAST_FILE" ]]; then
    echo "Error: No deployment broadcast found at:"
    echo "  $BROADCAST_FILE"
    echo ""
    echo "Run 'make deploy-contracts' first."
    exit 1
fi

# Check for jq
if ! command -v jq &> /dev/null; then
    echo "Error: 'jq' is required but not installed."
    echo "Install with: sudo apt install jq  (or brew install jq on macOS)"
    exit 1
fi

# Parse the JSON — filter to CREATE transactions only (skip CALLs)
STEM_NFT=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "StemNFT") | .contractAddress' "$BROADCAST_FILE")
MARKETPLACE=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2") | .contractAddress' "$BROADCAST_FILE")
TRANSFER_VALIDATOR=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "TransferValidator") | .contractAddress' "$BROADCAST_FILE")

echo -e "${GREEN}Deployed Protocol Addresses:${NC}"
echo "  StemNFT:             $STEM_NFT"
echo "  StemMarketplaceV2:   $MARKETPLACE"
echo "  TransferValidator:   $TRANSFER_VALIDATOR"
echo ""

# Function to update or add env variable
update_env_var() {
    local var_name="$1"
    local var_value="$2"
    local env_file="$3"
    
    if [[ -z "$var_value" || "$var_value" == "null" ]]; then
        return
    fi

    if grep -q "^${var_name}=" "$env_file" 2>/dev/null; then
        # Variable exists, update it
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|^${var_name}=.*|${var_name}=${var_value}|" "$env_file"
        else
            sed -i "s|^${var_name}=.*|${var_name}=${var_value}|" "$env_file"
        fi
    else
        # Variable doesn't exist, append it
        echo "${var_name}=${var_value}" >> "$env_file"
    fi
}

# --- Update backend/.env ---
if [[ ! -f "$BACKEND_ENV" ]]; then
    echo "Creating $BACKEND_ENV..."
    touch "$BACKEND_ENV"
fi

echo "Updating $BACKEND_ENV..."
update_env_var "STEM_NFT_ADDRESS" "$STEM_NFT" "$BACKEND_ENV"
update_env_var "MARKETPLACE_ADDRESS" "$MARKETPLACE" "$BACKEND_ENV"
update_env_var "TRANSFER_VALIDATOR_ADDRESS" "$TRANSFER_VALIDATOR" "$BACKEND_ENV"
update_env_var "ENABLE_CONTRACT_INDEXER" "true" "$BACKEND_ENV"
echo -e "${GREEN}✓ backend/.env updated${NC}"

# --- Update web/.env.local ---
if [[ ! -f "$WEB_ENV_LOCAL" ]]; then
    echo "Creating $WEB_ENV_LOCAL..."
    touch "$WEB_ENV_LOCAL"
fi

echo "Updating $WEB_ENV_LOCAL..."
update_env_var "NEXT_PUBLIC_STEM_NFT_ADDRESS" "$STEM_NFT" "$WEB_ENV_LOCAL"
update_env_var "NEXT_PUBLIC_MARKETPLACE_ADDRESS" "$MARKETPLACE" "$WEB_ENV_LOCAL"
update_env_var "NEXT_PUBLIC_CHAIN_ID" "$CHAIN_ID" "$WEB_ENV_LOCAL"
echo -e "${GREEN}✓ web/.env.local updated${NC}"

# --- Reset indexer to near-current block ---
echo ""
echo "Resetting indexer state to current block..."
CURRENT_BLOCK_HEX=$(curl -sf "$RPC_URL" -X POST \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    | jq -r '.result' 2>/dev/null || echo "")

if [[ -n "$CURRENT_BLOCK_HEX" && "$CURRENT_BLOCK_HEX" != "null" ]]; then
    CURRENT_BLOCK=$(printf "%d" "$CURRENT_BLOCK_HEX" 2>/dev/null || echo "0")
else
    CURRENT_BLOCK=0
fi

if [[ "$CURRENT_BLOCK" -gt 0 ]]; then
    RESET_BLOCK=$((CURRENT_BLOCK - 1))
    cd "$PROJECT_ROOT/backend" && node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.indexerState.upsert({
  where: { chainId: ${CHAIN_ID} },
  update: { lastBlockNumber: BigInt(${RESET_BLOCK}) },
  create: { chainId: ${CHAIN_ID}, lastBlockNumber: BigInt(${RESET_BLOCK}) }
}).then(() => { console.log('Indexer reset to block ${RESET_BLOCK}'); return p.\$disconnect(); })
  .catch(e => { console.error('Failed to reset indexer:', e.message); process.exit(1); });
"
    echo -e "${GREEN}✓ Indexer state reset to block ${RESET_BLOCK} (chain ${CHAIN_ID})${NC}"
else
    echo -e "${YELLOW}Warning: Could not get current block, skipping indexer reset${NC}"
fi

echo ""

# Print summary
echo "=== Protocol Configuration Complete ==="
echo ""
echo "Chain ID: $CHAIN_ID"
echo ""
echo "Backend .env protocol vars:"
grep -E "^(STEM_NFT|MARKETPLACE|TRANSFER_VALIDATOR|ENABLE_CONTRACT)_" "$BACKEND_ENV" 2>/dev/null | sed 's/^/  /' || echo "  (none found)"
echo ""
echo "Web .env.local protocol vars:"
grep -E "^NEXT_PUBLIC_(STEM_NFT|MARKETPLACE|CHAIN_ID)_?" "$WEB_ENV_LOCAL" 2>/dev/null | sed 's/^/  /' || echo "  (none found)"
echo ""
echo -e "${GREEN}Remember to restart services to pick up new config:${NC}"
echo "  • Backend: make backend-dev"
echo "  • Frontend: make web-dev-fork  (or make web-dev-local)"
echo ""
