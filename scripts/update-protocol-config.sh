#!/usr/bin/env bash
# update-protocol-config.sh - Parse Forge deployment output and update .env files
#
# Reads the latest DeployProtocol broadcast JSON and updates backend/.env
# and web/.env.local with StemNFT, StemMarketplaceV2, and TransferValidator
# contract addresses.
#
# Usage: ./scripts/update-protocol-config.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BROADCAST_FILE="$PROJECT_ROOT/contracts/broadcast/DeployProtocol.s.sol/31337/run-latest.json"
BACKEND_ENV="$PROJECT_ROOT/backend/.env"
WEB_ENV_LOCAL="$PROJECT_ROOT/web/.env.local"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Updating Protocol Configuration ==="
echo ""

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
echo -e "${GREEN}✓ backend/.env updated${NC}"

# --- Update web/.env.local ---
if [[ ! -f "$WEB_ENV_LOCAL" ]]; then
    echo "Creating $WEB_ENV_LOCAL..."
    touch "$WEB_ENV_LOCAL"
fi

echo "Updating $WEB_ENV_LOCAL..."
update_env_var "NEXT_PUBLIC_STEM_NFT_ADDRESS" "$STEM_NFT" "$WEB_ENV_LOCAL"
update_env_var "NEXT_PUBLIC_MARKETPLACE_ADDRESS" "$MARKETPLACE" "$WEB_ENV_LOCAL"
echo -e "${GREEN}✓ web/.env.local updated${NC}"

echo ""

# Print summary
echo "=== Protocol Configuration Complete ==="
echo ""
echo "Backend .env protocol vars:"
grep -E "^(STEM_NFT|MARKETPLACE|TRANSFER_VALIDATOR)_" "$BACKEND_ENV" 2>/dev/null | sed 's/^/  /' || echo "  (none found)"
echo ""
echo "Web .env.local protocol vars:"
grep -E "^NEXT_PUBLIC_(STEM_NFT|MARKETPLACE)_" "$WEB_ENV_LOCAL" 2>/dev/null | sed 's/^/  /' || echo "  (none found)"
echo ""
echo -e "${GREEN}Remember to restart services to pick up new config:${NC}"
echo "  • Backend: make backend-dev"
echo "  • Frontend: make web-dev-local"
echo ""
