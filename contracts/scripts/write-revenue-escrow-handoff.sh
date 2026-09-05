#!/usr/bin/env bash
# Parse a narrow DeployRevenueEscrow broadcast into non-secret deployment handoffs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACTS_DIR="${CONTRACTS_DIR:-$PROJECT_ROOT/contracts}"
DEPLOYMENTS_DIR="${DEPLOYMENTS_DIR:-$CONTRACTS_DIR/deployments}"

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required." >&2; exit 1; }

chain_id="${CHAIN_ID:-}"
if [[ -z "$chain_id" && -n "${RPC_URL:-}" ]] && command -v cast >/dev/null 2>&1; then
  chain_id="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || true)"
fi
chain_id="${chain_id:-84532}"
case "$chain_id" in
  31337|1337) network="local" ;;
  84532) network="base-sepolia" ;;
  11155111) network="sepolia" ;;
  *) network="chain-$chain_id" ;;
esac

broadcast_file="${BROADCAST_FILE:-$CONTRACTS_DIR/broadcast/DeployRevenueEscrow.s.sol/$chain_id/run-latest.json}"
artifact_file="${REVENUE_ESCROW_ARTIFACT:-$CONTRACTS_DIR/out/RevenueEscrow.sol/RevenueEscrow.json}"
[[ -f "$broadcast_file" ]] || { echo "Error: broadcast not found: $broadcast_file" >&2; exit 1; }
[[ -f "$artifact_file" ]] || { echo "Error: artifact not found: $artifact_file" >&2; exit 1; }

read_create() {
  local name="$1" field="$2"
  jq -r --arg name "$name" --arg field "$field" \
    'first(.transactions[] | select(.transactionType == "CREATE" and .contractName == $name)) | .[$field] // empty' \
    "$broadcast_file"
}

proxy="$(read_create ERC1967Proxy contractAddress)"
implementation="$(read_create RevenueEscrow contractAddress)"
timelock="$(read_create TimelockController contractAddress)"
deploy_tx="$(read_create ERC1967Proxy hash)"
deployer="$(jq -r 'first(.transactions[] | select(.transactionType == "CREATE" and .contractName == "ERC1967Proxy")) | .transaction.from // .from // empty' "$broadcast_file")"
if [[ -z "$deployer" && -n "${PRIVATE_KEY:-}" ]] && command -v cast >/dev/null 2>&1; then
  deployer="$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || true)"
fi

owner="${REVENUE_ESCROW_OWNER:-$deployer}"
guardian="${REVENUE_ESCROW_GUARDIAN:-$owner}"
period="${REVENUE_ESCROW_PERIOD:-2592000}"
delay="${REVENUE_ESCROW_TIMELOCK_MIN_DELAY:-172800}"

if [[ "$network" != "local" && -z "${REVENUE_ESCROW_GUARDIAN:-}" ]]; then
  echo "Error: REVENUE_ESCROW_GUARDIAN is required for shared-network handoffs." >&2
  exit 1
fi
for pair in "proxy:$proxy" "implementation:$implementation" "timelock:$timelock" "deployer:$deployer" "owner:$owner" "guardian:$guardian"; do
  name="${pair%%:*}"; value="${pair#*:}"
  [[ "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "Error: $name address is missing or malformed." >&2; exit 1; }
done
for pair in "period:$period" "delay:$delay"; do
  name="${pair%%:*}"; value="${pair#*:}"
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "Error: $name is missing or malformed." >&2; exit 1; }
done

block_raw="$(jq -r --arg tx "$deploy_tx" 'first(.receipts[]? | select((.transactionHash // .hash // "") == $tx)) | .blockNumber // empty' "$broadcast_file")"
[[ "$block_raw" =~ ^(0x[0-9a-fA-F]+|[0-9]+)$ ]] || { echo "Error: deployment block missing." >&2; exit 1; }
block_number="$((block_raw))"

mkdir -p "$DEPLOYMENTS_DIR"
record_file="$DEPLOYMENTS_DIR/revenue-escrow.$network.json"
env_file="$DEPLOYMENTS_DIR/revenue-escrow.$network.remote.env"
abi_file="$DEPLOYMENTS_DIR/revenue-escrow.abi.json"
jq '.abi' "$artifact_file" > "$abi_file"
abi_sha256="$(sha256sum "$abi_file" | awk '{print $1}')"

jq -n \
  --arg network "$network" --argjson chainId "$chain_id" --arg deployer "$deployer" \
  --arg owner "$owner" --arg guardian "$guardian" --argjson period "$period" --argjson delay "$delay" \
  --arg proxy "$proxy" --arg implementation "$implementation" --arg timelock "$timelock" \
  --arg deployTx "$deploy_tx" --argjson blockNumber "$block_number" \
  --arg broadcastFile "${broadcast_file#$PROJECT_ROOT/}" --arg artifactFile "${artifact_file#$PROJECT_ROOT/}" \
  --arg abiFile "${abi_file#$PROJECT_ROOT/}" --arg abiSha256 "$abi_sha256" \
  --arg deployedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '{network:$network,chainId:$chainId,deployer:$deployer,owner:$owner,guardian:$guardian,
    defaultEscrowPeriodSeconds:$period,timelockMinDelaySeconds:$delay,deployedAt:$deployedAt,
    contracts:{RevenueEscrow:$proxy,RevenueEscrowImplementation:$implementation,RevenueEscrowTimelock:$timelock},
    upgradeability:{pattern:"UUPS-ERC1967",proxy:$proxy,implementation:$implementation,upgradeAuthority:$timelock},
    governance:{owner:$owner,guardian:$guardian,timelock:$timelock,timelockMinDelaySeconds:$delay,deployerAdminRenounced:true},
    deployment:{transaction:$deployTx,blockNumber:$blockNumber,broadcastFile:$broadcastFile,artifactFile:$artifactFile},
    abi:{file:$abiFile,sha256:$abiSha256}}' > "$record_file"

cat > "$env_file" <<EOF
# RevenueEscrow deployment handoff. No secrets are included.
NEXT_PUBLIC_CHAIN_ID=$chain_id
# App-facing address is always the stable ERC1967 proxy.
REVENUE_ESCROW_ADDRESS=$proxy
REVENUE_ESCROW_IMPLEMENTATION=$implementation
REVENUE_ESCROW_TIMELOCK_ADDRESS=$timelock
REVENUE_ESCROW_OWNER=$owner
REVENUE_ESCROW_DEPLOYER=$deployer
REVENUE_ESCROW_GUARDIAN=$guardian
REVENUE_ESCROW_PERIOD=$period
REVENUE_ESCROW_TIMELOCK_MIN_DELAY=$delay
REVENUE_ESCROW_PAUSED=false
REVENUE_ESCROW_DEPLOYMENT_BLOCK=$block_number
EOF

echo "RevenueEscrow deployment record: $record_file"
echo "RevenueEscrow remote env handoff: $env_file"
echo "RevenueEscrow ABI handoff: $abi_file"
