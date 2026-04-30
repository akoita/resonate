#!/usr/bin/env bash
# verify-base-sepolia-sourcify.sh — Verify Base Sepolia contracts through Sourcify
#
# This script does not deploy anything and does not require API keys. It reads the
# latest Forge broadcast, rebuilds exact Foundry build-info compiler inputs, and
# submits them to Sourcify's v2 verification API.
#
# Usage:
#   make verify-base-sepolia-sourcify
#
# Optional:
#   VERIFY_ONLY=TransferValidator make verify-base-sepolia-sourcify
#   BROADCAST_FILE=contracts/broadcast/DeployProtocol.s.sol/84532/run-...json make verify-base-sepolia-sourcify

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
SOURCIFY_API_URL="${SOURCIFY_API_URL:-https://sourcify.dev/server}"
SOURCIFY_CHAIN_ID="${SOURCIFY_CHAIN_ID:-84532}"
SOURCIFY_COMPILER_VERSION="${SOURCIFY_COMPILER_VERSION:-0.8.28+commit.7893614a}"
SOURCIFY_RETRIES="${SOURCIFY_RETRIES:-12}"
SOURCIFY_DELAY_SECONDS="${SOURCIFY_DELAY_SECONDS:-5}"

echo -e "${BLUE}=== Resonate Protocol — Base Sepolia Sourcify Verification ===${NC}"
echo ""

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
    exit 1
fi

echo "Broadcast: $BROADCAST_FILE"
echo "Chain:     Base Sepolia ($SOURCIFY_CHAIN_ID)"
echo "Verifier:  $SOURCIFY_API_URL"
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
        PaymentAssetRegistry)
            echo "src/payments/PaymentAssetRegistry.sol:PaymentAssetRegistry"
            ;;
        StemMarketplaceV2)
            echo "src/core/StemMarketplaceV2.sol:StemMarketplaceV2"
            ;;
        *)
            return 1
            ;;
    esac
}

source_path_for() {
    local contract_id="$1"
    echo "${contract_id%%:*}"
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
        --force \
        --quiet

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

submit_one() {
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
    local payload
    standard_json="$(mktemp)"
    payload="$(mktemp)"

    if ! build_standard_json_input "$contract_name" "$contract_id" "$standard_json"; then
        rm -f "$standard_json" "$payload"
        echo ""
        return 1
    fi

    jq -n \
        --slurpfile stdJsonInput "$standard_json" \
        --arg compilerVersion "$SOURCIFY_COMPILER_VERSION" \
        --arg contractIdentifier "$contract_id" \
        --arg creationTransactionHash "$creation_tx" \
        '{
            stdJsonInput: $stdJsonInput[0],
            compilerVersion: $compilerVersion,
            contractIdentifier: $contractIdentifier,
            creationTransactionHash: $creationTransactionHash
        }' > "$payload"

    local response
    response="$(curl -sS \
        -X POST "$SOURCIFY_API_URL/v2/verify/$SOURCIFY_CHAIN_ID/$address" \
        -H 'Content-Type: application/json' \
        --data-binary "@$payload")"

    rm -f "$standard_json" "$payload"

    local verification_id
    verification_id="$(jq -r '.verificationId // empty' <<< "$response")"
    if [[ -z "$verification_id" ]]; then
        local message
        message="$(jq -r '.message // .error // .customCode // tostring' <<< "$response")"
        if grep -Eqi "already|verified" <<< "$message"; then
            echo -e "${GREEN}✓ $contract_name already verified${NC}"
            echo ""
            return 0
        fi
        echo -e "${RED}✗ $contract_name submission failed${NC}"
        echo "  $message"
        echo ""
        return 1
    fi

    echo "  Verification ID: $verification_id"
    poll_verification "$contract_name" "$verification_id"
}

poll_verification() {
    local contract_name="$1"
    local verification_id="$2"
    local attempt=1

    while [[ "$attempt" -le "$SOURCIFY_RETRIES" ]]; do
        sleep "$SOURCIFY_DELAY_SECONDS"

        local response
        response="$(curl -sS "$SOURCIFY_API_URL/v2/verify/$verification_id")"

        local completed
        local match
        local runtime_match
        local creation_match
        local error
        completed="$(jq -r '.isJobCompleted // false' <<< "$response")"
        match="$(jq -r '.contract.match // empty' <<< "$response")"
        runtime_match="$(jq -r '.contract.runtimeMatch // empty' <<< "$response")"
        creation_match="$(jq -r '.contract.creationMatch // empty' <<< "$response")"
        error="$(jq -r '.error // .message // empty' <<< "$response")"

        if [[ "$completed" == "true" && -n "$match" ]]; then
            echo -e "${GREEN}✓ $contract_name verified: $match (runtime: $runtime_match, creation: $creation_match)${NC}"
            local repo_url
            repo_url="https://repo.sourcify.dev/$SOURCIFY_CHAIN_ID/$(read_create_field "$contract_name" "contractAddress")"
            echo "  Sourcify: $repo_url"
            echo ""
            return 0
        fi

        if [[ "$completed" == "true" ]]; then
            echo -e "${RED}✗ $contract_name verification failed${NC}"
            jq . <<< "$response"
            [[ -n "$error" ]] && echo "  $error"
            echo ""
            return 1
        fi

        echo "  Status: pending ($attempt/$SOURCIFY_RETRIES)"
        attempt=$((attempt + 1))
    done

    echo -e "${RED}✗ Timed out waiting for Sourcify verification for $contract_name${NC}"
    echo ""
    return 1
}

cd "$CONTRACTS_DIR"

CONTRACTS=(
    TransferValidator
    ContentProtection
    ERC1967Proxy
    DisputeResolution
    CurationRewards
    RevenueEscrow
    StemNFT
    PaymentAssetRegistry
    StemMarketplaceV2
)

if [[ -n "${VERIFY_ONLY:-}" ]]; then
    CONTRACTS=("$VERIFY_ONLY")
fi

FAILED=()
for contract_name in "${CONTRACTS[@]}"; do
    if ! submit_one "$contract_name"; then
        FAILED+=("$contract_name")
    fi
done

if [[ "${#FAILED[@]}" -gt 0 ]]; then
    echo -e "${RED}Sourcify verification finished with failures:${NC}"
    printf '  - %s\n' "${FAILED[@]}"
    exit 1
fi

echo -e "${GREEN}=== All contracts verified on Sourcify ===${NC}"
