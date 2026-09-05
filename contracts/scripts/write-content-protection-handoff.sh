#!/usr/bin/env bash
# Parse a deployment broadcast into non-secret ContentProtection handoffs.

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

broadcast_file="${BROADCAST_FILE:-$CONTRACTS_DIR/broadcast/DeployContentProtection.s.sol/$chain_id/run-latest.json}"
artifact_file="${CONTENT_PROTECTION_ARTIFACT:-$CONTRACTS_DIR/out/ContentProtection.sol/ContentProtection.json}"
[[ -f "$broadcast_file" ]] || { echo "Error: broadcast not found: $broadcast_file" >&2; exit 1; }
[[ -f "$artifact_file" ]] || { echo "Error: artifact not found: $artifact_file" >&2; exit 1; }

implementation_index="$(jq -r 'first(.transactions | to_entries[] | select(.value.transactionType == "CREATE" and .value.contractName == "ContentProtection")) | .key // empty' "$broadcast_file")"
[[ "$implementation_index" =~ ^[0-9]+$ ]] || { echo "Error: ContentProtection implementation missing." >&2; exit 1; }

read_after_implementation() {
  local name="$1" field="$2"
  jq -r --arg name "$name" --arg field "$field" --argjson index "$implementation_index" \
    'first(.transactions | to_entries[] | select(.key > $index and .value.transactionType == "CREATE" and .value.contractName == $name)) | .value[$field] // empty' \
    "$broadcast_file"
}

implementation="$(jq -r --argjson index "$implementation_index" '.transactions[$index].contractAddress // empty' "$broadcast_file")"
timelock="$(read_after_implementation TimelockController contractAddress)"
proxy="$(read_after_implementation ERC1967Proxy contractAddress)"
deploy_tx="$(read_after_implementation ERC1967Proxy hash)"
deployer="$(jq -r --argjson index "$implementation_index" '.transactions[$index].transaction.from // .transactions[$index].from // empty' "$broadcast_file")"
if [[ -z "$deployer" && -n "${PRIVATE_KEY:-}" ]] && command -v cast >/dev/null 2>&1; then
  deployer="$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || true)"
fi

owner="${CONTENT_PROTECTION_OWNER:-$deployer}"
guardian="${CONTENT_PROTECTION_GUARDIAN:-$owner}"
delay="${CONTENT_PROTECTION_TIMELOCK_MIN_DELAY:-172800}"
pending_owner=""
[[ "${owner,,}" != "${deployer,,}" ]] && pending_owner="$owner"

if [[ "$network" != "local" && -z "${CONTENT_PROTECTION_GUARDIAN:-}" ]]; then
  echo "Error: CONTENT_PROTECTION_GUARDIAN is required for shared-network handoffs." >&2
  exit 1
fi
for pair in "proxy:$proxy" "implementation:$implementation" "timelock:$timelock" "deployer:$deployer" "owner:$owner" "guardian:$guardian"; do
  name="${pair%%:*}"; value="${pair#*:}"
  [[ "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "Error: $name address is missing or malformed." >&2; exit 1; }
done
[[ "$deploy_tx" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "Error: proxy deployment transaction hash is missing or malformed." >&2; exit 1; }
[[ "$delay" =~ ^[0-9]+$ ]] || { echo "Error: delay is missing or malformed." >&2; exit 1; }

block_raw="$(jq -r --arg tx "$deploy_tx" 'first(.receipts[]? | select((.transactionHash // .hash // "") == $tx)) | .blockNumber // empty' "$broadcast_file")"
[[ "$block_raw" =~ ^(0x[0-9a-fA-F]+|[0-9]+)$ ]] || { echo "Error: deployment block missing." >&2; exit 1; }
block_number="$((block_raw))"

mkdir -p "$DEPLOYMENTS_DIR"
record_file="$DEPLOYMENTS_DIR/content-protection.$network.json"
env_file="$DEPLOYMENTS_DIR/content-protection.$network.remote.env"
abi_file="$DEPLOYMENTS_DIR/content-protection.abi.json"
jq '.abi' "$artifact_file" > "$abi_file"
abi_sha256="$(sha256sum "$abi_file" | awk '{print $1}')"

jq -n \
  --arg network "$network" --argjson chainId "$chain_id" --arg deployer "$deployer" \
  --arg owner "$owner" --arg pendingOwner "$pending_owner" --arg guardian "$guardian" --argjson delay "$delay" \
  --arg proxy "$proxy" --arg implementation "$implementation" --arg timelock "$timelock" \
  --arg deployTx "$deploy_tx" --argjson blockNumber "$block_number" \
  --arg broadcastFile "${broadcast_file#$PROJECT_ROOT/}" --arg artifactFile "${artifact_file#$PROJECT_ROOT/}" \
  --arg abiFile "${abi_file#$PROJECT_ROOT/}" --arg abiSha256 "$abi_sha256" \
  --arg deployedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '{network:$network,chainId:$chainId,deployer:$deployer,owner:$owner,liveOwner:$deployer,pendingOwner:$pendingOwner,guardian:$guardian,
    timelockMinDelaySeconds:$delay,paused:false,deployedAt:$deployedAt,
    contracts:{ContentProtection:$proxy,ContentProtectionImplementation:$implementation,ContentProtectionTimelock:$timelock},
    upgradeability:{pattern:"UUPS-ERC1967",storage:"legacy-linear-append-only",proxy:$proxy,implementation:$implementation,upgradeAuthority:$timelock},
    governance:{owner:$owner,liveOwner:$deployer,pendingOwner:$pendingOwner,guardian:$guardian,timelock:$timelock,timelockMinDelaySeconds:$delay,deployerAdminRenounced:true},
    deployment:{transaction:$deployTx,blockNumber:$blockNumber,broadcastFile:$broadcastFile,artifactFile:$artifactFile},
    abi:{file:$abiFile,sha256:$abiSha256}}' > "$record_file"

cat > "$env_file" <<EOF
# ContentProtection deployment handoff. No secrets are included.
NEXT_PUBLIC_CHAIN_ID=$chain_id
CONTENT_PROTECTION_ADDRESS=$proxy
CONTENT_PROTECTION_PROXY=$proxy
CONTENT_PROTECTION_IMPLEMENTATION=$implementation
CONTENT_PROTECTION_TIMELOCK_ADDRESS=$timelock
CONTENT_PROTECTION_OWNER=$owner
CONTENT_PROTECTION_LIVE_OWNER=$deployer
CONTENT_PROTECTION_PENDING_OWNER=$pending_owner
CONTENT_PROTECTION_DEPLOYER=$deployer
CONTENT_PROTECTION_GUARDIAN=$guardian
CONTENT_PROTECTION_TIMELOCK_MIN_DELAY=$delay
CONTENT_PROTECTION_PAUSED=false
CONTENT_PROTECTION_DEPLOYMENT_BLOCK=$block_number
EOF

echo "ContentProtection deployment record: $record_file"
echo "ContentProtection remote env handoff: $env_file"
echo "ContentProtection ABI handoff: $abi_file"
