#!/usr/bin/env bash
# update-aa-config.sh - Parse Forge deployment output and update .env files
#
# This script reads the latest deployment broadcast JSON and updates
# backend/.env with the deployed contract addresses.
#
# Usage: ./scripts/update-aa-config.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BROADCAST_FILE="$PROJECT_ROOT/contracts/broadcast/DeployLocalAA.s.sol/31337/run-latest.json"
BACKEND_ENV="$PROJECT_ROOT/backend/.env"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse --mode argument (default: local)
MODE="local"
for arg in "$@"; do
    case $arg in
        --mode)
            shift
            MODE="$1"
            shift
            ;;
        --mode=*)
            MODE="${arg#*=}"
            shift
            ;;
    esac
done

echo "=== Updating AA Configuration (mode: $MODE) ==="
echo ""

# ================================================
# Fork mode: use known Sepolia contract addresses
# ================================================
if [[ "$MODE" == "fork" ]]; then
    echo -e "${GREEN}Forked Sepolia Mode${NC}"
    echo "Using known Sepolia contract addresses (ZeroDev Kernel v3)"
    echo ""

    # Canonical Sepolia addresses for ZeroDev / ERC-4337 v0.7
    ENTRY_POINT="0x0000000071727De22E5E9d8BAf0edAc6f37da032"
    # ZeroDev Kernel v3 factory (Sepolia)
    KERNEL_FACTORY="0x5de4839a76cf55d0c90e2061ef4386d962E15ae3"
    ECDSA_VALIDATOR="0xd9AB5096a832b9ce79914329DAEE236f8Eea0390"

    # Source .env for ZERODEV_PROJECT_ID
    if [[ -f "$BACKEND_ENV" ]]; then
        source "$BACKEND_ENV" 2>/dev/null || true
    fi

    ZERODEV_PROJECT_ID="${ZERODEV_PROJECT_ID:-}"
    if [[ -n "$ZERODEV_PROJECT_ID" ]]; then
        BUNDLER_URL="https://rpc.zerodev.app/api/v2/bundler/${ZERODEV_PROJECT_ID}"
        PAYMASTER_URL="https://rpc.zerodev.app/api/v2/paymaster/${ZERODEV_PROJECT_ID}"
        echo -e "${GREEN}ZeroDev Project ID:${NC} $ZERODEV_PROJECT_ID"
    else
        BUNDLER_URL="http://localhost:4337"
        PAYMASTER_URL=""
        echo -e "${YELLOW}Warning: ZERODEV_PROJECT_ID not set, using localhost bundler${NC}"
    fi

    # Ensure backend/.env exists
    if [[ ! -f "$BACKEND_ENV" ]]; then
        echo "Creating $BACKEND_ENV..."
        touch "$BACKEND_ENV"
    fi

    # Source the update function
    update_env_var() {
        local var_name="$1"
        local var_value="$2"
        local env_file="$3"

        if [[ -z "$var_value" || "$var_value" == "null" ]]; then
            return
        fi

        if grep -q "^${var_name}=" "$env_file" 2>/dev/null; then
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s|^${var_name}=.*|${var_name}=${var_value}|" "$env_file"
            else
                sed -i "s|^${var_name}=.*|${var_name}=${var_value}|" "$env_file"
            fi
        else
            echo "${var_name}=${var_value}" >> "$env_file"
        fi
    }

    # Essential dev defaults
    update_env_var "DATABASE_URL" "postgresql://resonate:resonate@localhost:5432/resonate" "$BACKEND_ENV"
    update_env_var "JWT_SECRET" "dev-secret-change-in-production" "$BACKEND_ENV"

    # Sepolia AA addresses
    update_env_var "AA_ENTRY_POINT" "$ENTRY_POINT" "$BACKEND_ENV"
    update_env_var "AA_FACTORY" "$KERNEL_FACTORY" "$BACKEND_ENV"
    update_env_var "AA_ECDSA_VALIDATOR" "$ECDSA_VALIDATOR" "$BACKEND_ENV"
    update_env_var "AA_CHAIN_ID" "11155111" "$BACKEND_ENV"
    update_env_var "AA_BUNDLER" "$BUNDLER_URL" "$BACKEND_ENV"
    update_env_var "BLOCK_EXPLORER_URL" "https://sepolia.etherscan.io" "$BACKEND_ENV"

    echo ""
    echo -e "${GREEN}✓ backend/.env updated for forked Sepolia${NC}"

    # Update web/.env.local chain ID for fork mode
    WEB_ENV_LOCAL="$PROJECT_ROOT/web/.env.local"
    if [[ ! -f "$WEB_ENV_LOCAL" ]]; then
        touch "$WEB_ENV_LOCAL"
    fi
    update_env_var "NEXT_PUBLIC_CHAIN_ID" "11155111" "$WEB_ENV_LOCAL"
    echo -e "${GREEN}✓ web/.env.local NEXT_PUBLIC_CHAIN_ID set to 11155111${NC}"

    echo ""
    echo "Backend .env now contains:"
    grep -E "^AA_|^ZERODEV|^BLOCK_EXPLORER" "$BACKEND_ENV" | sed 's/^/  /'
    echo ""
    echo -e "${GREEN}Remember to restart services:${NC}"
    echo "  • Backend: make backend-dev"
    echo "  • Frontend: make web-dev-fork"
    exit 0
fi

# ================================================
# Local mode: parse Forge deployment broadcast
# ================================================
if [[ ! -f "$BROADCAST_FILE" ]]; then
    echo "Error: No deployment broadcast found at:"
    echo "  $BROADCAST_FILE"
    echo ""
    echo "Run 'make local-aa-deploy' first."
    exit 1
fi

# Extract addresses from broadcast JSON using jq
if ! command -v jq &> /dev/null; then
    echo "Error: 'jq' is required but not installed."
    echo "Install with: sudo apt install jq  (or brew install jq on macOS)"
    exit 1
fi

# Parse the JSON to get deployed contract addresses
ENTRY_POINT=$(jq -r '.transactions[] | select(.contractName == "EntryPoint") | .contractAddress' "$BROADCAST_FILE")
KERNEL=$(jq -r '.transactions[] | select(.contractName == "Kernel") | .contractAddress' "$BROADCAST_FILE")
KERNEL_FACTORY=$(jq -r '.transactions[] | select(.contractName == "KernelFactory") | .contractAddress' "$BROADCAST_FILE")
ECDSA_VALIDATOR=$(jq -r '.transactions[] | select(.contractName == "ECDSAValidator") | .contractAddress' "$BROADCAST_FILE")
SIG_VALIDATOR=$(jq -r '.transactions[] | select(.contractName == "UniversalSigValidator") | .contractAddress' "$BROADCAST_FILE")

echo -e "${GREEN}Deployed Contract Addresses:${NC}"
echo "  EntryPoint:             $ENTRY_POINT"
echo "  Kernel Implementation:  $KERNEL"
echo "  KernelFactory:          $KERNEL_FACTORY"
echo "  ECDSAValidator:         $ECDSA_VALIDATOR"
echo "  UniversalSigValidator:  $SIG_VALIDATOR"
echo ""

# Also get the bundler's supported entry point
BUNDLER_URL="http://localhost:4337"
echo "Checking bundler's supported entry points..."
BUNDLER_ENTRYPOINT=$(curl -s "$BUNDLER_URL" -X POST \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}' \
    2>/dev/null | jq -r '.result[0]' 2>/dev/null || echo "")

if [[ -n "$BUNDLER_ENTRYPOINT" && "$BUNDLER_ENTRYPOINT" != "null" ]]; then
    echo -e "${GREEN}Bundler Entry Point:${NC} $BUNDLER_ENTRYPOINT"
    # Use bundler's entry point as it's what the bundler will accept
    ENTRY_POINT="$BUNDLER_ENTRYPOINT"
    echo -e "${YELLOW}Note: Using bundler's entry point for AA_ENTRY_POINT${NC}"
else
    echo -e "${YELLOW}Warning: Could not reach bundler at $BUNDLER_URL${NC}"
fi
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

# Ensure backend/.env exists
if [[ ! -f "$BACKEND_ENV" ]]; then
    echo "Creating $BACKEND_ENV..."
    touch "$BACKEND_ENV"
fi

# Update backend/.env
echo "Updating $BACKEND_ENV..."

# Essential dev defaults (set once if missing)
update_env_var "DATABASE_URL" "postgresql://resonate:resonate@localhost:5432/resonate" "$BACKEND_ENV"
update_env_var "JWT_SECRET" "dev-secret-change-in-production" "$BACKEND_ENV"

# AA contract addresses (updated on each deploy)
update_env_var "AA_ENTRY_POINT" "$ENTRY_POINT" "$BACKEND_ENV"
update_env_var "AA_FACTORY" "$KERNEL_FACTORY" "$BACKEND_ENV"
update_env_var "AA_KERNEL" "$KERNEL" "$BACKEND_ENV"
update_env_var "AA_ECDSA_VALIDATOR" "$ECDSA_VALIDATOR" "$BACKEND_ENV"
update_env_var "AA_SIG_VALIDATOR" "$SIG_VALIDATOR" "$BACKEND_ENV"
update_env_var "AA_CHAIN_ID" "31337" "$BACKEND_ENV"
update_env_var "AA_BUNDLER" "http://localhost:4337" "$BACKEND_ENV"

echo -e "${GREEN}✓ backend/.env updated${NC}"

echo ""

# Create a web/.env.local if it doesn't exist (for frontend)
WEB_ENV_LOCAL="$PROJECT_ROOT/web/.env.local"
if [[ ! -f "$WEB_ENV_LOCAL" ]]; then
    echo "Creating $WEB_ENV_LOCAL..."
    cat > "$WEB_ENV_LOCAL" << EOF
# Local AA Development Configuration
# Generated by scripts/update-aa-config.sh

# Chain ID for local Anvil
NEXT_PUBLIC_CHAIN_ID=31337

# Disable ZeroDev for local development
# NEXT_PUBLIC_ZERODEV_PROJECT_ID=

# API URL
NEXT_PUBLIC_API_URL=http://localhost:3000
EOF
    echo -e "${GREEN}✓ web/.env.local created${NC}"
else
    echo -e "${YELLOW}web/.env.local already exists, not overwriting${NC}"
fi
echo ""

# Print summary
echo "=== Configuration Complete ==="
echo ""
echo "Backend .env now contains:"
grep -E "^AA_" "$BACKEND_ENV" | sed 's/^/  /'
echo ""
echo -e "${GREEN}Remember to restart services to pick up new config:${NC}"
echo "  • Backend: make backend-dev"
echo "  • Frontend: make web-dev-local"
echo ""
