#!/usr/bin/env bash
# Parse a DeployLocalAA broadcast and refresh app-local AA configuration.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_ENV="${AA_BACKEND_ENV_FILE:-$PROJECT_ROOT/backend/.env}"
WEB_ENV_LOCAL="${AA_WEB_ENV_FILE:-$PROJECT_ROOT/web/.env.local}"
DEFAULT_SEPOLIA_RPC_URL="https://sepolia.drpc.org"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

MODE="local"
CHAIN_ID=""
RPC_URL=""
BUNDLER_URL=""
BROADCAST_FILE=""

usage() {
    cat <<'EOF'
Usage: update-aa-config.sh [options]

Options:
  --mode local|fork|custom  Configuration mode (default: local)
  --chain-id ID             Required for custom mode
  --rpc-url URL             Execution RPC exposed to the apps
  --bundler-url URL         ERC-4337 bundler RPC exposed to the apps
  --broadcast-file PATH     DeployLocalAA Foundry broadcast JSON
  --help                    Show this help

For isolated tests, AA_BACKEND_ENV_FILE and AA_WEB_ENV_FILE may point at
temporary env files. They never change deployment or signing behavior.
EOF
}

require_value() {
    local option="$1"
    local value="${2:-}"
    if [[ -z "$value" ]]; then
        echo "Error: $option requires a value." >&2
        exit 2
    fi
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode)
            require_value "$1" "${2:-}"
            MODE="$2"
            shift 2
            ;;
        --mode=*) MODE="${1#*=}"; shift ;;
        --chain-id)
            require_value "$1" "${2:-}"
            CHAIN_ID="$2"
            shift 2
            ;;
        --chain-id=*) CHAIN_ID="${1#*=}"; shift ;;
        --rpc-url)
            require_value "$1" "${2:-}"
            RPC_URL="$2"
            shift 2
            ;;
        --rpc-url=*) RPC_URL="${1#*=}"; shift ;;
        --bundler-url)
            require_value "$1" "${2:-}"
            BUNDLER_URL="$2"
            shift 2
            ;;
        --bundler-url=*) BUNDLER_URL="${1#*=}"; shift ;;
        --broadcast-file)
            require_value "$1" "${2:-}"
            BROADCAST_FILE="$2"
            shift 2
            ;;
        --broadcast-file=*) BROADCAST_FILE="${1#*=}"; shift ;;
        --help|-h) usage; exit 0 ;;
        *) echo "Error: Unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

case "$MODE" in
    local)
        CHAIN_ID="${CHAIN_ID:-31337}"
        RPC_URL="${RPC_URL:-http://localhost:8545}"
        BUNDLER_URL="${BUNDLER_URL:-http://localhost:4337}"
        ;;
    fork)
        CHAIN_ID="${CHAIN_ID:-11155111}"
        RPC_URL="${RPC_URL:-http://localhost:8545}"
        ;;
    custom)
        if [[ -z "$CHAIN_ID" || -z "$RPC_URL" ]]; then
            echo "Error: custom mode requires --chain-id and --rpc-url." >&2
            exit 2
        fi
        BUNDLER_URL="${BUNDLER_URL:-http://localhost:4337}"
        ;;
    *)
        echo "Error: Unsupported mode '$MODE'. Use local, fork, or custom." >&2
        exit 2
        ;;
esac

if [[ ! "$CHAIN_ID" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: chain ID must be a positive integer." >&2
    exit 2
fi
for url in "$RPC_URL" ${BUNDLER_URL:+"$BUNDLER_URL"}; do
    if [[ ! "$url" =~ ^https?://[^[:space:]]+$ ]]; then
        echo "Error: RPC and bundler URLs must be absolute HTTP(S) URLs without whitespace." >&2
        exit 2
    fi
done

update_env_var() {
    local key="$1"
    local value="$2"
    local env_file="$3"
    local temp_file

    if [[ -z "$value" || "$value" == "null" ]]; then
        return
    fi
    if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
        echo "Error: refusing to write a multiline value for $key." >&2
        exit 2
    fi

    mkdir -p "$(dirname "$env_file")"
    touch "$env_file"
    temp_file="$(mktemp "${env_file}.tmp.XXXXXX")"
    awk -v key="$key" -v value="$value" '
        BEGIN { found = 0 }
        index($0, key "=") == 1 { print key "=" value; found = 1; next }
        { print }
        END { if (!found) print key "=" value }
    ' "$env_file" > "$temp_file"
    mv "$temp_file" "$env_file"
}

ensure_env_var() {
    local key="$1"
    local value="$2"
    local env_file="$3"

    mkdir -p "$(dirname "$env_file")"
    touch "$env_file"
    if ! grep -q "^${key}=" "$env_file"; then
        printf '%s=%s\n' "$key" "$value" >> "$env_file"
    fi
}

validate_address() {
    local label="$1"
    local address="$2"
    if [[ ! "$address" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        echo "Error: deployment output has no valid $label address." >&2
        exit 1
    fi
}

echo "=== Updating AA Configuration (mode: $MODE, chain: $CHAIN_ID) ==="
echo ""

if [[ "$MODE" == "fork" ]]; then
    ENTRY_POINT="0x0000000071727De22E5E9d8BAf0edAc6f37da032"
    KERNEL="0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D"
    KERNEL_FACTORY="0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419"
    ECDSA_VALIDATOR="0xd9AB5096a832b9ce79914329DAEE236f8Eea0390"
    SIG_VALIDATOR=""

    if [[ -z "$BUNDLER_URL" ]]; then
        ZERODEV_PROJECT_ID="${ZERODEV_PROJECT_ID:-}"
        if [[ -z "$ZERODEV_PROJECT_ID" && -f "$BACKEND_ENV" ]]; then
            ZERODEV_PROJECT_ID="$(sed -n 's/^ZERODEV_PROJECT_ID=//p' "$BACKEND_ENV" | tail -1)"
        fi
        if [[ -n "$ZERODEV_PROJECT_ID" ]]; then
            BUNDLER_URL="https://rpc.zerodev.app/api/v2/bundler/${ZERODEV_PROJECT_ID}"
        else
            BUNDLER_URL="http://localhost:4337"
            echo -e "${YELLOW}Warning: ZERODEV_PROJECT_ID is unset; using localhost Alto.${NC}"
        fi
    fi
    USE_META_FACTORY="true"
else
    BROADCAST_FILE="${BROADCAST_FILE:-$PROJECT_ROOT/contracts/broadcast/DeployLocalAA.s.sol/$CHAIN_ID/run-latest.json}"
    if [[ ! -f "$BROADCAST_FILE" ]]; then
        echo "Error: no DeployLocalAA broadcast found at $BROADCAST_FILE" >&2
        exit 1
    fi
    if ! command -v jq >/dev/null 2>&1; then
        echo "Error: jq is required." >&2
        exit 1
    fi

    contract_address() {
        local contract_name="$1"
        jq -r --arg name "$contract_name" \
            '.transactions[] | select(.transactionType == "CREATE" and .contractName == $name) | .contractAddress' \
            "$BROADCAST_FILE" | tail -1
    }

    ENTRY_POINT="$(contract_address EntryPoint)"
    KERNEL="$(contract_address Kernel)"
    KERNEL_FACTORY="$(contract_address KernelFactory)"
    ECDSA_VALIDATOR="$(contract_address ECDSAValidator)"
    SIG_VALIDATOR="$(contract_address UniversalSigValidator)"
    validate_address EntryPoint "$ENTRY_POINT"
    validate_address Kernel "$KERNEL"
    validate_address KernelFactory "$KERNEL_FACTORY"
    validate_address ECDSAValidator "$ECDSA_VALIDATOR"
    validate_address UniversalSigValidator "$SIG_VALIDATOR"
    USE_META_FACTORY="false"

    echo "Checking whether the bundler advertises the deployed EntryPoint..."
    BUNDLER_ENTRYPOINTS="$(curl --max-time 5 -fsS "$BUNDLER_URL" -X POST \
        -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}' \
        2>/dev/null | jq -r '.result[]?' 2>/dev/null || true)"
    if [[ -n "$BUNDLER_ENTRYPOINTS" ]]; then
        if ! printf '%s\n' "$BUNDLER_ENTRYPOINTS" | grep -Fxiq "$ENTRY_POINT"; then
            echo "Error: bundler does not advertise deployed EntryPoint $ENTRY_POINT." >&2
            echo "Restart Alto with this EntryPoint before refreshing app configuration." >&2
            exit 1
        fi
        echo -e "${GREEN}Bundler EntryPoint matches the deployment.${NC}"
    else
        echo -e "${YELLOW}Warning: bundler is unreachable; configuration was generated but runtime is not validated.${NC}"
    fi
fi

ensure_env_var DATABASE_URL "postgresql://resonate:resonate@localhost:5432/resonate" "$BACKEND_ENV"
ensure_env_var JWT_SECRET "dev-secret-change-in-production" "$BACKEND_ENV"
update_env_var AA_ENTRY_POINT "$ENTRY_POINT" "$BACKEND_ENV"
update_env_var AA_FACTORY "$KERNEL_FACTORY" "$BACKEND_ENV"
update_env_var AA_KERNEL "$KERNEL" "$BACKEND_ENV"
update_env_var AA_ECDSA_VALIDATOR "$ECDSA_VALIDATOR" "$BACKEND_ENV"
update_env_var AA_SIG_VALIDATOR "$SIG_VALIDATOR" "$BACKEND_ENV"
update_env_var AA_KERNEL_VERSION "0.3.1" "$BACKEND_ENV"
update_env_var AA_CHAIN_ID "$CHAIN_ID" "$BACKEND_ENV"
update_env_var AA_BUNDLER "$BUNDLER_URL" "$BACKEND_ENV"
update_env_var RPC_URL "$RPC_URL" "$BACKEND_ENV"
update_env_var LOCAL_RPC_URL "$RPC_URL" "$BACKEND_ENV"
if [[ "$MODE" == "fork" ]]; then
    update_env_var SEPOLIA_RPC_URL "${SEPOLIA_RPC_URL:-$DEFAULT_SEPOLIA_RPC_URL}" "$BACKEND_ENV"
    update_env_var BLOCK_EXPLORER_URL "https://sepolia.etherscan.io" "$BACKEND_ENV"
fi

if [[ ! -f "$WEB_ENV_LOCAL" ]]; then
    mkdir -p "$(dirname "$WEB_ENV_LOCAL")"
    printf '%s\n' \
        '# Local AA Development Configuration' \
        '# Generated by contracts/scripts/update-aa-config.sh' \
        '' \
        'NEXT_PUBLIC_API_URL=http://localhost:3000' > "$WEB_ENV_LOCAL"
fi
update_env_var NEXT_PUBLIC_CHAIN_ID "$CHAIN_ID" "$WEB_ENV_LOCAL"
update_env_var NEXT_PUBLIC_RPC_URL "$RPC_URL" "$WEB_ENV_LOCAL"
update_env_var NEXT_PUBLIC_AA_ENTRY_POINT "$ENTRY_POINT" "$WEB_ENV_LOCAL"
update_env_var NEXT_PUBLIC_AA_FACTORY "$KERNEL_FACTORY" "$WEB_ENV_LOCAL"
update_env_var NEXT_PUBLIC_AA_KERNEL "$KERNEL" "$WEB_ENV_LOCAL"
update_env_var NEXT_PUBLIC_AA_KERNEL_VERSION "0.3.1" "$WEB_ENV_LOCAL"
update_env_var NEXT_PUBLIC_AA_USE_META_FACTORY "$USE_META_FACTORY" "$WEB_ENV_LOCAL"

echo ""
echo -e "${GREEN}AA configuration updated.${NC}"
echo "  Chain ID: $CHAIN_ID"
echo "  EntryPoint: $ENTRY_POINT"
echo "  Kernel: $KERNEL"
echo "  Factory: $KERNEL_FACTORY"
echo "  Backend env: $BACKEND_ENV"
echo "  Web env: $WEB_ENV_LOCAL"
echo "Bundler and RPC URLs were written but are not printed because they may contain credentials."
