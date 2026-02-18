#!/usr/bin/env bash
# deploy-sepolia.sh — Deploy Resonate Protocol contracts to Sepolia testnet
#
# Prerequisites:
#   - Foundry installed (forge, cast)
#   - PRIVATE_KEY env var set (deployer wallet private key)
#   - SEPOLIA_RPC_URL env var set (e.g. https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY)
#   - ETHERSCAN_API_KEY env var set (for contract verification)
#   - Deployer wallet funded with Sepolia ETH (>= 0.05 ETH recommended)
#
# Usage:
#   export PRIVATE_KEY=<your-deployer-private-key>
#   export SEPOLIA_RPC_URL=<your-sepolia-rpc-url>
#   export ETHERSCAN_API_KEY=<your-etherscan-api-key>
#   ./scripts/deploy-sepolia.sh
#
# ⚠️  NEVER commit private keys — this script reads from env vars only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"
DEPLOYMENTS_DIR="$CONTRACTS_DIR/deployments"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Resonate Protocol — Sepolia Deployment ===${NC}"
echo ""

# --- Preflight checks ---

if [[ -z "${PRIVATE_KEY:-}" ]]; then
    echo -e "${RED}Error: PRIVATE_KEY env var not set${NC}"
    echo "  export PRIVATE_KEY=<your-deployer-private-key>"
    echo "  ⚠️  Never commit this value!"
    exit 1
fi

if [[ -z "${SEPOLIA_RPC_URL:-}" ]]; then
    echo -e "${RED}Error: SEPOLIA_RPC_URL env var not set${NC}"
    echo "  export SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY"
    exit 1
fi

if [[ -z "${ETHERSCAN_API_KEY:-}" ]]; then
    echo -e "${YELLOW}Warning: ETHERSCAN_API_KEY not set — contracts won't be verified on Etherscan${NC}"
    VERIFY_FLAG=""
else
    VERIFY_FLAG="--verify"
fi

if ! command -v forge &> /dev/null; then
    echo -e "${RED}Error: 'forge' not found. Install Foundry: https://getfoundry.sh${NC}"
    exit 1
fi

# --- Check deployer balance ---

DEPLOYER_ADDRESS=$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || echo "")
if [[ -z "$DEPLOYER_ADDRESS" ]]; then
    echo -e "${RED}Error: Invalid private key${NC}"
    exit 1
fi

echo -e "Deployer: ${GREEN}$DEPLOYER_ADDRESS${NC}"

BALANCE_WEI=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL" 2>/dev/null || echo "0")
BALANCE_ETH=$(cast from-wei "$BALANCE_WEI" 2>/dev/null || echo "0")
echo -e "Balance:  ${GREEN}$BALANCE_ETH ETH${NC}"

# Rough check: need at least 0.01 ETH for gas
MIN_WEI="10000000000000000"
if [[ "$BALANCE_WEI" -lt "$MIN_WEI" ]]; then
    echo -e "${RED}Error: Insufficient Sepolia ETH (need >= 0.01 ETH)${NC}"
    echo "  Get testnet ETH from: https://www.alchemy.com/faucets/ethereum-sepolia"
    exit 1
fi

echo ""

# --- Deploy contracts ---

echo -e "${BLUE}Deploying contracts to Sepolia...${NC}"
echo ""

cd "$CONTRACTS_DIR"

forge script script/DeployProtocol.s.sol \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --broadcast \
    $VERIFY_FLAG \
    --slow \
    2>&1 | tee /tmp/resonate-deploy-output.log

echo ""

# --- Parse deployed addresses from broadcast ---

BROADCAST_FILE="$CONTRACTS_DIR/broadcast/DeployProtocol.s.sol/11155111/run-latest.json"

if [[ ! -f "$BROADCAST_FILE" ]]; then
    echo -e "${RED}Error: Broadcast file not found at $BROADCAST_FILE${NC}"
    echo "Deployment may have failed. Check output above."
    exit 1
fi

STEM_NFT=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "StemNFT") | .contractAddress' "$BROADCAST_FILE")
MARKETPLACE=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2") | .contractAddress' "$BROADCAST_FILE")
TRANSFER_VALIDATOR=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "TransferValidator") | .contractAddress' "$BROADCAST_FILE")
DEPLOY_TX=$(jq -r '.transactions[0].hash' "$BROADCAST_FILE")
DEPLOY_BLOCK=$(jq -r '.receipts[0].blockNumber' "$BROADCAST_FILE" 2>/dev/null || echo "unknown")

echo -e "${GREEN}=== Deployment Successful ===${NC}"
echo ""
echo -e "  StemNFT:             ${GREEN}$STEM_NFT${NC}"
echo -e "  StemMarketplaceV2:   ${GREEN}$MARKETPLACE${NC}"
echo -e "  TransferValidator:   ${GREEN}$TRANSFER_VALIDATOR${NC}"
echo -e "  First TX:            $DEPLOY_TX"
echo ""

# --- Save deployment record (safe — no private keys) ---

mkdir -p "$DEPLOYMENTS_DIR"

DEPLOY_RECORD="$DEPLOYMENTS_DIR/sepolia.json"
cat > "$DEPLOY_RECORD" <<EOF
{
  "network": "sepolia",
  "chainId": 11155111,
  "deployer": "$DEPLOYER_ADDRESS",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "contracts": {
    "StemNFT": "$STEM_NFT",
    "StemMarketplaceV2": "$MARKETPLACE",
    "TransferValidator": "$TRANSFER_VALIDATOR"
  },
  "verification": {
    "etherscan": "https://sepolia.etherscan.io/address/$STEM_NFT",
    "marketplace": "https://sepolia.etherscan.io/address/$MARKETPLACE",
    "validator": "https://sepolia.etherscan.io/address/$TRANSFER_VALIDATOR"
  },
  "firstTransaction": "$DEPLOY_TX"
}
EOF

echo -e "${GREEN}✓ Deployment record saved to $DEPLOY_RECORD${NC}"
echo ""

# --- Update .env files ---

echo -e "${BLUE}Updating .env files with deployed addresses...${NC}"
RPC_URL="$SEPOLIA_RPC_URL" "$SCRIPT_DIR/update-protocol-config.sh"

echo ""
echo -e "${GREEN}=== All Done! ===${NC}"
echo ""
echo "Next steps:"
echo "  1. Verify contracts on Etherscan (if not auto-verified):"
echo "     https://sepolia.etherscan.io/address/$STEM_NFT#code"
echo "  2. Update GCP Secret Manager with deployed addresses"
echo "  3. Restart backend to pick up new config: make backend-dev"
echo ""
