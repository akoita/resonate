#!/usr/bin/env bash
# verify-base-sepolia.sh — Retry BaseScan verification for the latest Base Sepolia deployment
#
# This script does not deploy anything and does not require PRIVATE_KEY. It reads
# the Forge broadcast file from the latest Base Sepolia deploy and retries
# explorer verification for every CREATE transaction.
#
# Usage:
#   export ETHERSCAN_API_KEY=<your-etherscan-v2-api-key>
#   make verify-base-sepolia
#
# Optional:
#   BROADCAST_FILE=contracts/broadcast/DeployProtocol.s.sol/84532/run-...json make verify-base-sepolia
#   VERIFY_RETRIES=10 VERIFY_DELAY_SECONDS=20 make verify-base-sepolia
#   VERIFY_ONLY=TransferValidator make verify-base-sepolia

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACTS_DIR="$PROJECT_ROOT/contracts"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BROADCAST_FILE="${BROADCAST_FILE:-$CONTRACTS_DIR/broadcast/DeployProtocol.s.sol/84532/run-latest.json}"
BASE_SEPOLIA_RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
VERIFY_RETRIES="${VERIFY_RETRIES:-8}"
VERIFY_DELAY_SECONDS="${VERIFY_DELAY_SECONDS:-15}"
BASESCAN_API_URL="${BASESCAN_API_URL:-https://api.etherscan.io/v2/api}"
BASESCAN_CHAIN_ID="${BASESCAN_CHAIN_ID:-84532}"
BASESCAN_SUBMIT_URL="$BASESCAN_API_URL"
if [[ "$BASESCAN_API_URL" == *"/v2/"* ]]; then
    BASESCAN_SUBMIT_URL="${BASESCAN_API_URL}?chainid=$BASESCAN_CHAIN_ID"
fi

echo -e "${BLUE}=== Resonate Protocol — Base Sepolia Verification Retry ===${NC}"
echo ""

EXPLORER_API_KEY="${ETHERSCAN_API_KEY:-${BASESCAN_API_KEY:-}}"

if [[ -z "$EXPLORER_API_KEY" ]]; then
    echo -e "${RED}Error: ETHERSCAN_API_KEY env var not set${NC}"
    echo "  export ETHERSCAN_API_KEY=<your-etherscan-v2-api-key-with-base-sepolia-access>"
    exit 1
fi

if [[ ! -f "$BROADCAST_FILE" ]]; then
    echo -e "${RED}Error: Broadcast file not found at $BROADCAST_FILE${NC}"
    echo "Run 'make deploy-base-sepolia' first, or pass BROADCAST_FILE=/path/to/run-*.json."
    exit 1
fi
BROADCAST_FILE="$(cd "$(dirname "$BROADCAST_FILE")" && pwd)/$(basename "$BROADCAST_FILE")"

if ! command -v forge &> /dev/null; then
    echo -e "${RED}Error: 'forge' not found. Install Foundry: https://getfoundry.sh${NC}"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: 'jq' is required but not installed.${NC}"
    echo "Install with: sudo apt install jq  (or brew install jq on macOS)"
    exit 1
fi

echo "Broadcast: $BROADCAST_FILE"
echo "Chain:     Base Sepolia (84532)"
echo ""

contract_id_for() {
    case "$1" in
        TransferValidator)
            echo "src/modules/TransferValidator.sol:TransferValidator"
            ;;
        ContentProtection)
            echo "src/core/ContentProtection.sol:ContentProtection"
            ;;
        ERC1967Proxy)
            echo "lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
            ;;
        DisputeResolution)
            echo "src/core/DisputeResolution.sol:DisputeResolution"
            ;;
        CurationRewards)
            echo "src/core/CurationRewards.sol:CurationRewards"
            ;;
        RevenueEscrow)
            echo "src/core/RevenueEscrow.sol:RevenueEscrow"
            ;;
        StemNFT)
            echo "src/core/StemNFT.sol:StemNFT"
            ;;
        StemMarketplaceV2)
            echo "src/core/StemMarketplaceV2.sol:StemMarketplaceV2"
            ;;
        *)
            return 1
            ;;
    esac
}

read_create_field() {
    local contract_name="$1"
    local field="$2"
    jq -r \
        --arg name "$contract_name" \
        --arg field "$field" \
        'first(.transactions[] | select(.transactionType == "CREATE" and .contractName == $name)) | .[$field] // empty' \
        "$BROADCAST_FILE"
}

artifact_path_for() {
    local contract_name="$1"
    echo "$CONTRACTS_DIR/out/${contract_name}.sol/${contract_name}.json"
}

source_path_for() {
    local contract_id="$1"
    echo "${contract_id%%:*}"
}

build_standard_json_input() {
    local contract_name="$1"
    local contract_id="$2"
    local standard_json="$3"
    local source_path
    source_path="$(source_path_for "$contract_id")"

    local build_info_dir
    build_info_dir="$(mktemp -d)"

    forge build "$source_path" \
        --build-info \
        --build-info-path "$build_info_dir" \
        --force >/dev/null

    local build_info_file=""
    while IFS= read -r candidate; do
        if jq -e \
            --arg source "$source_path" \
            --arg name "$contract_name" \
            '.output.contracts[$source][$name] != null' \
            "$candidate" >/dev/null; then
            build_info_file="$candidate"
            break
        fi
    done < <(find "$build_info_dir" -type f -name '*.json' | sort)

    if [[ -z "$build_info_file" ]]; then
        rm -rf "$build_info_dir"
        echo -e "${RED}✗ Build info not found for $contract_id${NC}"
        return 1
    fi

    jq '.input | del(.allowPaths, .basePath, .includePaths, .version)' \
        "$build_info_file" > "$standard_json"
    rm -rf "$build_info_dir"
}

runtime_bytecode_matches() {
    local artifact_path="$1"
    local address="$2"
    local local_bytecode
    local remote_bytecode

    local_bytecode="$(jq -r '.deployedBytecode.object' "$artifact_path" | sed 's/^0x//' | tr '[:upper:]' '[:lower:]')"
    remote_bytecode="$(cast code "$address" --rpc-url "$BASE_SEPOLIA_RPC_URL" | sed 's/^0x//' | tr '[:upper:]' '[:lower:]')"

    [[ -n "$local_bytecode" && "$local_bytecode" == "$remote_bytecode" ]]
}

verify_one() {
    local contract_name="$1"
    local contract_id
    contract_id="$(contract_id_for "$contract_name")"

    local address
    local creation_tx
    address="$(read_create_field "$contract_name" "contractAddress")"
    creation_tx="$(read_create_field "$contract_name" "hash")"

    if [[ -z "$address" || -z "$creation_tx" ]]; then
        echo -e "${RED}✗ $contract_name missing from broadcast CREATE transactions${NC}"
        echo ""
        return 1
    fi

    echo -e "${BLUE}Verifying $contract_name${NC}"
    echo "  Address: $address"
    echo "  Contract: $contract_id"
    echo "  Creation tx: $creation_tx"

    local standard_json
    standard_json="$(mktemp)"
    if ! build_standard_json_input "$contract_name" "$contract_id" "$standard_json"; then
        rm -f "$standard_json"
        echo ""
        return 1
    fi

    local artifact_path
    artifact_path="$(artifact_path_for "$contract_name")"
    if [[ ! -f "$artifact_path" ]]; then
        echo -e "${RED}✗ Artifact not found for $contract_name at $artifact_path${NC}"
        rm -f "$standard_json"
        echo ""
        return 1
    fi

    local constructor_args
    constructor_args="$(constructor_args_for "$contract_name")"

    local submit_response
    submit_response="$(curl -fsS \
        --url "$BASESCAN_SUBMIT_URL" \
        --data-urlencode "chainid=$BASESCAN_CHAIN_ID" \
        --data-urlencode "apikey=$EXPLORER_API_KEY" \
        --data-urlencode "module=contract" \
        --data-urlencode "action=verifysourcecode" \
        --data-urlencode "contractaddress=$address" \
        --data-urlencode "sourceCode@$standard_json" \
        --data-urlencode "codeformat=solidity-standard-json-input" \
        --data-urlencode "contractname=$contract_id" \
        --data-urlencode "compilerversion=v0.8.28+commit.7893614a" \
        --data-urlencode "optimizationUsed=1" \
        --data-urlencode "runs=200" \
        --data-urlencode "evmVersion=cancun" \
        --data-urlencode "constructorArguments=$constructor_args" \
        --data-urlencode "licenseType=3")"
    rm -f "$standard_json"

    local submit_status
    local submit_result
    submit_status="$(jq -r '.status // empty' <<< "$submit_response")"
    submit_result="$(jq -r '.result // empty' <<< "$submit_response")"

    if [[ "$submit_status" != "1" ]]; then
        if grep -qi "already verified" <<< "$submit_result"; then
            echo -e "${GREEN}✓ $contract_name already verified${NC}"
            echo ""
            return 0
        fi
        echo -e "${RED}✗ $contract_name verification submission failed${NC}"
        echo "  $submit_result"
        echo ""
        return 1
    fi

    echo "  Submitted GUID: $submit_result"
    if poll_verification "$contract_name" "$submit_result"; then
        echo -e "${GREEN}✓ $contract_name verified${NC}"
        echo ""
        return 0
    fi

    if runtime_bytecode_matches "$artifact_path" "$address"; then
        echo -e "${YELLOW}  Local Foundry artifact bytecode matches on-chain runtime.${NC}"
        echo -e "${YELLOW}  Explorer rejection is not a deployment/source mismatch; retry later or contact Etherscan/BaseScan with the GUID above.${NC}"
    fi

    echo -e "${RED}✗ $contract_name verification failed${NC}"
    echo ""
    return 1
}

constructor_args_for() {
    local contract_name="$1"
    mapfile -t args < <(
        jq -r \
            --arg name "$contract_name" \
            'first(.transactions[] | select(.transactionType == "CREATE" and .contractName == $name)) | .arguments // [] | .[]' \
            "$BROADCAST_FILE"
    )

    case "$contract_name" in
        TransferValidator|ContentProtection)
            echo ""
            ;;
        ERC1967Proxy)
            cast abi-encode "constructor(address,bytes)" "${args[0]}" "${args[1]}" | sed 's/^0x//'
            ;;
        DisputeResolution)
            cast abi-encode "constructor(address)" "${args[0]}" | sed 's/^0x//'
            ;;
        CurationRewards)
            cast abi-encode "constructor(address,address,address,address)" "${args[0]}" "${args[1]}" "${args[2]}" "${args[3]}" | sed 's/^0x//'
            ;;
        RevenueEscrow)
            cast abi-encode "constructor(address,uint256)" "${args[0]}" "${args[1]}" | sed 's/^0x//'
            ;;
        StemNFT)
            cast abi-encode "constructor(string)" "${args[0]}" | sed 's/^0x//'
            ;;
        StemMarketplaceV2)
            cast abi-encode "constructor(address,address,address,uint256)" "${args[0]}" "${args[1]}" "${args[2]}" "${args[3]}" | sed 's/^0x//'
            ;;
        *)
            echo ""
            ;;
    esac
}

poll_verification() {
    local contract_name="$1"
    local guid="$2"
    local attempt=1

    while [[ "$attempt" -le "$VERIFY_RETRIES" ]]; do
        sleep "$VERIFY_DELAY_SECONDS"

        local response
        response="$(curl -fsS \
            --url "$BASESCAN_SUBMIT_URL" \
            --data-urlencode "chainid=$BASESCAN_CHAIN_ID" \
            --data-urlencode "apikey=$EXPLORER_API_KEY" \
            --data-urlencode "module=contract" \
            --data-urlencode "action=checkverifystatus" \
            --data-urlencode "guid=$guid")"

        local status
        local result
        status="$(jq -r '.status // empty' <<< "$response")"
        result="$(jq -r '.result // empty' <<< "$response")"

        echo "  Status: $result"

        if [[ "$status" == "1" ]]; then
            return 0
        fi
        if grep -qi "already verified" <<< "$result"; then
            return 0
        fi
        if ! grep -qi "pending" <<< "$result"; then
            echo -e "${RED}  BaseScan rejected $contract_name: $result${NC}"
            return 1
        fi

        attempt=$((attempt + 1))
    done

    echo -e "${RED}  Timed out waiting for BaseScan verification for $contract_name${NC}"
    return 1
}

cd "$CONTRACTS_DIR"

FAILED=()
CONTRACTS=(
    TransferValidator
    ContentProtection
    ERC1967Proxy
    DisputeResolution
    CurationRewards
    RevenueEscrow
    StemNFT
    StemMarketplaceV2
)

if [[ -n "${VERIFY_ONLY:-}" ]]; then
    CONTRACTS=("$VERIFY_ONLY")
fi

for contract_name in "${CONTRACTS[@]}"; do
    if ! verify_one "$contract_name"; then
        FAILED+=("$contract_name")
    fi
done

if [[ "${#FAILED[@]}" -gt 0 ]]; then
    echo -e "${RED}Verification finished with failures:${NC}"
    printf '  - %s\n' "${FAILED[@]}"
    echo ""
    echo "Fix the explorer API issue and retry:"
    echo "  ETHERSCAN_API_KEY=<etherscan-v2-key-with-base-sepolia-access> make verify-base-sepolia"
    exit 1
fi

echo -e "${GREEN}=== All contracts verified ===${NC}"
