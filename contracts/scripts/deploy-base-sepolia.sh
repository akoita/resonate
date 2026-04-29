#!/usr/bin/env bash
# deploy-base-sepolia.sh — Deploy Resonate Protocol contracts to Base Sepolia
#
# Prerequisites:
#   - Foundry installed (forge, cast)
#   - PRIVATE_KEY env var set (deployer wallet private key)
#   - BASE_SEPOLIA_RPC_URL env var set (e.g. https://sepolia.base.org)
#   - ETHERSCAN_API_KEY or BASESCAN_API_KEY env var set if contract verification is desired
#     (Etherscan API v2 key with Base Sepolia access)
#   - VERIFY_CONTRACTS=false if verification should be forced off even when
#     an explorer API key is set
#   - Deployer wallet funded with Base Sepolia ETH (>= 0.01 ETH recommended)
#
# Usage:
#   export PRIVATE_KEY=<your-deployer-private-key>
#   export BASE_SEPOLIA_RPC_URL=<your-base-sepolia-rpc-url>
#   export ETHERSCAN_API_KEY=<your-etherscan-v2-api-key>
#   ./contracts/scripts/deploy-base-sepolia.sh
#
# Never commit private keys — this script reads from env vars only.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"
DEPLOYMENTS_DIR="$CONTRACTS_DIR/deployments"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Resonate Protocol — Base Sepolia Deployment ===${NC}"
echo ""

if [[ -z "${PRIVATE_KEY:-}" ]]; then
    echo -e "${RED}Error: PRIVATE_KEY env var not set${NC}"
    echo "  export PRIVATE_KEY=<your-deployer-private-key>"
    echo "  Never commit this value."
    exit 1
fi

if [[ -z "${BASE_SEPOLIA_RPC_URL:-}" ]]; then
    echo -e "${RED}Error: BASE_SEPOLIA_RPC_URL env var not set${NC}"
    echo "  export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org"
    exit 1
fi

VERIFY_CONTRACTS="${VERIFY_CONTRACTS:-auto}"
if [[ "$VERIFY_CONTRACTS" == "auto" ]]; then
    if [[ -n "${ETHERSCAN_API_KEY:-${BASESCAN_API_KEY:-}}" ]]; then
        VERIFY_CONTRACTS="true"
    else
        VERIFY_CONTRACTS="false"
    fi
fi

EXPLORER_API_KEY="${ETHERSCAN_API_KEY:-${BASESCAN_API_KEY:-}}"

if [[ "$VERIFY_CONTRACTS" == "true" && -z "$EXPLORER_API_KEY" ]]; then
    echo -e "${RED}Error: VERIFY_CONTRACTS=true requires ETHERSCAN_API_KEY${NC}"
    exit 1
elif [[ "$VERIFY_CONTRACTS" == "true" ]]; then
    echo -e "${BLUE}Info: contract verification will run after deployment records are written.${NC}"
else
    echo -e "${YELLOW}Info: contract verification disabled. Set ETHERSCAN_API_KEY to verify during deploy.${NC}"
fi

if ! command -v forge &> /dev/null; then
    echo -e "${RED}Error: 'forge' not found. Install Foundry: https://getfoundry.sh${NC}"
    exit 1
fi

if ! command -v cast &> /dev/null; then
    echo -e "${RED}Error: 'cast' not found. Install Foundry: https://getfoundry.sh${NC}"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: 'jq' is required but not installed.${NC}"
    echo "Install with: sudo apt install jq  (or brew install jq on macOS)"
    exit 1
fi

CHAIN_ID_HEX=$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL" 2>/dev/null || echo "")
if [[ "$CHAIN_ID_HEX" != "84532" ]]; then
    echo -e "${RED}Error: BASE_SEPOLIA_RPC_URL resolved chain ID '$CHAIN_ID_HEX', expected 84532${NC}"
    exit 1
fi

DEPLOYER_ADDRESS=$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || echo "")
if [[ -z "$DEPLOYER_ADDRESS" ]]; then
    echo -e "${RED}Error: Invalid private key${NC}"
    exit 1
fi

echo -e "Deployer: ${GREEN}$DEPLOYER_ADDRESS${NC}"

BALANCE_WEI=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$BASE_SEPOLIA_RPC_URL" 2>/dev/null || echo "0")
BALANCE_ETH=$(cast from-wei "$BALANCE_WEI" 2>/dev/null || echo "0")
echo -e "Balance:  ${GREEN}$BALANCE_ETH ETH${NC}"

MIN_WEI="10000000000000000"
if [[ "$BALANCE_WEI" -lt "$MIN_WEI" ]]; then
    echo -e "${RED}Error: Insufficient Base Sepolia ETH (need >= 0.01 ETH)${NC}"
    echo "  Get testnet ETH from: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet"
    exit 1
fi

echo ""
echo -e "${BLUE}Deploying contracts to Base Sepolia...${NC}"
echo ""

cd "$CONTRACTS_DIR"

set +e
forge script script/DeployProtocol.s.sol \
    --rpc-url "$BASE_SEPOLIA_RPC_URL" \
    --broadcast \
    --evm-version cancun \
    --via-ir \
    --slow \
    2>&1 | tee /tmp/resonate-base-sepolia-deploy-output.log
FORGE_STATUS=${PIPESTATUS[0]}
set -e

echo ""

BROADCAST_FILE="$CONTRACTS_DIR/broadcast/DeployProtocol.s.sol/84532/run-latest.json"

if [[ ! -f "$BROADCAST_FILE" ]]; then
    echo -e "${RED}Error: Broadcast file not found at $BROADCAST_FILE${NC}"
    echo "Deployment may have failed. Check output above."
    exit 1
fi

if [[ "$FORGE_STATUS" -ne 0 ]]; then
    if grep -q "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL" /tmp/resonate-base-sepolia-deploy-output.log; then
        echo -e "${YELLOW}Warning: forge exited non-zero after successful on-chain execution. Continuing with broadcast parsing; check verification output above.${NC}"
    else
        echo -e "${RED}Error: forge deployment failed before successful on-chain execution.${NC}"
        exit "$FORGE_STATUS"
    fi
fi

STEM_NFT=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "StemNFT") | .contractAddress' "$BROADCAST_FILE")
MARKETPLACE=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2") | .contractAddress' "$BROADCAST_FILE")
TRANSFER_VALIDATOR=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "TransferValidator") | .contractAddress' "$BROADCAST_FILE")
CONTENT_PROTECTION=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "ERC1967Proxy") | .contractAddress' "$BROADCAST_FILE" | head -1)
DISPUTE_RESOLUTION=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "DisputeResolution") | .contractAddress' "$BROADCAST_FILE")
CURATION_REWARDS=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "CurationRewards") | .contractAddress' "$BROADCAST_FILE")
REVENUE_ESCROW=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "RevenueEscrow") | .contractAddress' "$BROADCAST_FILE")
DEPLOY_TX=$(jq -r '.transactions[0].hash' "$BROADCAST_FILE")

echo -e "${GREEN}=== Deployment Successful ===${NC}"
echo ""
echo -e "  StemNFT:             ${GREEN}$STEM_NFT${NC}"
echo -e "  StemMarketplaceV2:   ${GREEN}$MARKETPLACE${NC}"
echo -e "  TransferValidator:   ${GREEN}$TRANSFER_VALIDATOR${NC}"
echo -e "  ContentProtection:   ${GREEN}$CONTENT_PROTECTION${NC}"
echo -e "  DisputeResolution:   ${GREEN}$DISPUTE_RESOLUTION${NC}"
echo -e "  CurationRewards:     ${GREEN}$CURATION_REWARDS${NC}"
echo -e "  RevenueEscrow:       ${GREEN}$REVENUE_ESCROW${NC}"
echo -e "  First TX:            $DEPLOY_TX"
echo ""

mkdir -p "$DEPLOYMENTS_DIR"

DEPLOY_RECORD="$DEPLOYMENTS_DIR/base-sepolia.json"
REMOTE_ENV_RECORD="$DEPLOYMENTS_DIR/base-sepolia.remote.env"
X402_FACILITATOR_URL="${X402_FACILITATOR_URL:-https://x402.org/facilitator}"
cat > "$DEPLOY_RECORD" <<EOF
{
  "network": "base-sepolia",
  "chainId": 84532,
  "deployer": "$DEPLOYER_ADDRESS",
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "contracts": {
    "StemNFT": "$STEM_NFT",
    "StemMarketplaceV2": "$MARKETPLACE",
    "TransferValidator": "$TRANSFER_VALIDATOR",
    "ContentProtection": "$CONTENT_PROTECTION",
    "DisputeResolution": "$DISPUTE_RESOLUTION",
    "CurationRewards": "$CURATION_REWARDS",
    "RevenueEscrow": "$REVENUE_ESCROW"
  },
  "verification": {
    "basescan": "https://sepolia.basescan.org/address/$STEM_NFT",
    "marketplace": "https://sepolia.basescan.org/address/$MARKETPLACE",
    "validator": "https://sepolia.basescan.org/address/$TRANSFER_VALIDATOR",
    "contentProtection": "https://sepolia.basescan.org/address/$CONTENT_PROTECTION",
    "disputeResolution": "https://sepolia.basescan.org/address/$DISPUTE_RESOLUTION",
    "curationRewards": "https://sepolia.basescan.org/address/$CURATION_REWARDS",
    "revenueEscrow": "https://sepolia.basescan.org/address/$REVENUE_ESCROW"
  },
  "firstTransaction": "$DEPLOY_TX"
}
EOF

echo -e "${GREEN}✓ Deployment record saved to $DEPLOY_RECORD${NC}"
echo ""

cat > "$REMOTE_ENV_RECORD" <<EOF
# Base Sepolia deployment handoff for resonate-iac / GCP environments.
# Generated from contracts/broadcast/DeployProtocol.s.sol/84532/run-latest.json.
# No secrets are included. Fill RPC, payout, and service-specific secrets in the
# deployment environment or Secret Manager.

# Shared chain
NEXT_PUBLIC_CHAIN_ID=84532
RPC_URL=<base-sepolia-rpc-url>
BASE_SEPOLIA_RPC_URL=<base-sepolia-rpc-url>

# Frontend contract addresses
NEXT_PUBLIC_STEM_NFT_ADDRESS=$STEM_NFT
NEXT_PUBLIC_MARKETPLACE_ADDRESS=$MARKETPLACE
NEXT_PUBLIC_TRANSFER_VALIDATOR_ADDRESS=$TRANSFER_VALIDATOR
NEXT_PUBLIC_CONTENT_PROTECTION_ADDRESS=$CONTENT_PROTECTION
NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS=$DISPUTE_RESOLUTION
NEXT_PUBLIC_CURATION_REWARDS_ADDRESS=$CURATION_REWARDS

# Backend contract addresses
STEM_NFT_ADDRESS=$STEM_NFT
MARKETPLACE_ADDRESS=$MARKETPLACE
TRANSFER_VALIDATOR_ADDRESS=$TRANSFER_VALIDATOR
CONTENT_PROTECTION_ADDRESS=$CONTENT_PROTECTION
DISPUTE_RESOLUTION_ADDRESS=$DISPUTE_RESOLUTION
CURATION_REWARDS_ADDRESS=$CURATION_REWARDS
REVENUE_ESCROW_ADDRESS=$REVENUE_ESCROW
ENABLE_CONTRACT_INDEXER=true

# x402 on the same chain
X402_ENABLED=true
X402_NETWORK=eip155:84532
X402_FACILITATOR_URL=$X402_FACILITATOR_URL
X402_PAYOUT_ADDRESS=<base-sepolia-usdc-payout-address>
EOF

echo -e "${GREEN}✓ Remote deployment env handoff saved to $REMOTE_ENV_RECORD${NC}"
echo ""

if [[ "$VERIFY_CONTRACTS" == "true" ]]; then
    echo -e "${BLUE}Verifying deployed contracts from broadcast...${NC}"
    if BASE_SEPOLIA_RPC_URL="$BASE_SEPOLIA_RPC_URL" \
        ETHERSCAN_API_KEY="$EXPLORER_API_KEY" \
        BROADCAST_FILE="$BROADCAST_FILE" \
        "$SCRIPT_DIR/verify-base-sepolia.sh"; then
        echo -e "${GREEN}✓ Base Sepolia contracts verified${NC}"
    else
        echo -e "${YELLOW}Warning: contract verification failed after successful deployment.${NC}"
        echo "Retry without redeploying:"
        echo "  ETHERSCAN_API_KEY=<etherscan-v2-key-with-base-sepolia-access> make verify-base-sepolia"
    fi
    echo ""
fi

echo -e "${BLUE}Updating .env files with deployed Base Sepolia addresses...${NC}"
RPC_URL="$BASE_SEPOLIA_RPC_URL" "$SCRIPT_DIR/update-protocol-config.sh"

echo ""
echo -e "${GREEN}=== All Done! ===${NC}"
echo ""
echo "Next steps:"
echo "  1. Verify contracts on Sourcify if not auto-verified:"
echo "     make verify-base-sepolia-sourcify"
echo "     Optional BaseScan retry:"
echo "     ETHERSCAN_API_KEY=<etherscan-v2-key-with-base-sepolia-access> make verify-base-sepolia"
echo "  2. Update resonate-iac environment config from:"
echo "     $REMOTE_ENV_RECORD"
echo "  3. Restart backend/frontend so they pick up the new config"
echo ""
