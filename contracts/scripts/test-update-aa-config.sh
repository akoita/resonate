#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(mktemp -d)"
case "$TEST_DIR" in
    /tmp/*) ;;
    *) echo "Error: unexpected temporary directory: $TEST_DIR" >&2; exit 1 ;;
esac
trap 'rm -rf -- "$TEST_DIR"' EXIT

BACKEND_ENV="$TEST_DIR/backend.env"
WEB_ENV="$TEST_DIR/web.env"
BROADCAST="$TEST_DIR/broadcast.json"

printf '%s\n' \
    'DATABASE_URL=postgresql://existing/database' \
    'JWT_SECRET=existing-local-secret' > "$BACKEND_ENV"

jq -n '{transactions: [
    {transactionType: "CREATE", contractName: "EntryPoint", contractAddress: "0x1111111111111111111111111111111111111111"},
    {transactionType: "CREATE", contractName: "Kernel", contractAddress: "0x2222222222222222222222222222222222222222"},
    {transactionType: "CREATE", contractName: "KernelFactory", contractAddress: "0x3333333333333333333333333333333333333333"},
    {transactionType: "CREATE", contractName: "ECDSAValidator", contractAddress: "0x4444444444444444444444444444444444444444"},
    {transactionType: "CREATE", contractName: "UniversalSigValidator", contractAddress: "0x5555555555555555555555555555555555555555"}
]}' > "$BROADCAST"

if AA_BACKEND_ENV_FILE="$BACKEND_ENV" AA_WEB_ENV_FILE="$WEB_ENV" \
    "$SCRIPT_DIR/update-aa-config.sh" --mode custom >/dev/null 2>&1; then
    echo "Error: custom mode accepted missing chain/RPC configuration." >&2
    exit 1
fi

OUTPUT="$(
    AA_BACKEND_ENV_FILE="$BACKEND_ENV" AA_WEB_ENV_FILE="$WEB_ENV" \
        "$SCRIPT_DIR/update-aa-config.sh" \
        --mode custom \
        --chain-id 3151908 \
        --rpc-url http://127.0.0.1:32000 \
        --bundler-url 'http://127.0.0.1:65534/token-not-for-output' \
        --broadcast-file "$BROADCAST"
)"

grep -Fxq 'AA_CHAIN_ID=3151908' "$BACKEND_ENV"
grep -Fxq 'AA_KERNEL_VERSION=0.3.1' "$BACKEND_ENV"
grep -Fxq 'RPC_URL=http://127.0.0.1:32000' "$BACKEND_ENV"
grep -Fxq 'DATABASE_URL=postgresql://existing/database' "$BACKEND_ENV"
grep -Fxq 'JWT_SECRET=existing-local-secret' "$BACKEND_ENV"
grep -Fxq 'NEXT_PUBLIC_AA_KERNEL=0x2222222222222222222222222222222222222222' "$WEB_ENV"
grep -Fxq 'NEXT_PUBLIC_AA_USE_META_FACTORY=false' "$WEB_ENV"
if [[ "$OUTPUT" == *token-not-for-output* ]]; then
    echo "Error: script printed a potentially credential-bearing URL." >&2
    exit 1
fi

AA_BACKEND_ENV_FILE="$BACKEND_ENV" AA_WEB_ENV_FILE="$WEB_ENV" \
    "$SCRIPT_DIR/update-aa-config.sh" \
    --mode fork \
    --bundler-url http://127.0.0.1:4337 >/dev/null
grep -Fxq 'AA_CHAIN_ID=11155111' "$BACKEND_ENV"
grep -Fxq 'AA_KERNEL=0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D' "$BACKEND_ENV"
grep -Fxq 'NEXT_PUBLIC_AA_USE_META_FACTORY=true' "$WEB_ENV"

echo "update-aa-config.sh tests passed"
