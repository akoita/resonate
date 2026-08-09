#!/usr/bin/env bash
# Parse a migration-prepare or upgrade-schedule broadcast into non-secret candidate handoffs.

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

candidate_kind="${CONTENT_PROTECTION_CANDIDATE_KIND:-migration}"
case "$candidate_kind" in
  migration)
    default_broadcast="$CONTRACTS_DIR/broadcast/MigrateContentProtectionV6.s.sol/$chain_id/run-latest.json"
    record_base="content-protection-v6-migration.$network"
    status="prepared-not-executed"
    ;;
  upgrade)
    default_broadcast="$CONTRACTS_DIR/broadcast/UpgradeContentProtection.s.sol/$chain_id/run-latest.json"
    record_base="content-protection-upgrade.$network"
    status="scheduled-not-executed"
    ;;
  *) echo "Error: CONTENT_PROTECTION_CANDIDATE_KIND must be migration or upgrade." >&2; exit 1 ;;
esac
broadcast_file="${BROADCAST_FILE:-$default_broadcast}"
artifact_file="${CONTENT_PROTECTION_ARTIFACT:-$CONTRACTS_DIR/out/ContentProtection.sol/ContentProtection.json}"
proxy="${CONTENT_PROTECTION_PROXY:-}"
owner="${CONTENT_PROTECTION_OWNER:-}"
guardian="${CONTENT_PROTECTION_GUARDIAN:-}"
delay="${CONTENT_PROTECTION_TIMELOCK_MIN_DELAY:-172800}"
upgrade_salt=""
if [[ "$candidate_kind" == "upgrade" ]]; then
  upgrade_salt="${CONTENT_PROTECTION_UPGRADE_SALT:-0x0000000000000000000000000000000000000000000000000000000000000000}"
  [[ "$upgrade_salt" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "Error: upgrade salt is malformed." >&2; exit 1; }
fi

[[ -f "$broadcast_file" ]] || { echo "Error: broadcast not found: $broadcast_file" >&2; exit 1; }
[[ -f "$artifact_file" ]] || { echo "Error: artifact not found: $artifact_file" >&2; exit 1; }

implementation_index="$(jq -r 'first(.transactions | to_entries[] | select(.value.transactionType == "CREATE" and .value.contractName == "ContentProtection")) | .key // empty' "$broadcast_file")"
[[ "$implementation_index" =~ ^[0-9]+$ ]] || { echo "Error: candidate implementation missing." >&2; exit 1; }
implementation="$(jq -r --argjson index "$implementation_index" '.transactions[$index].contractAddress // empty' "$broadcast_file")"
deploy_tx="$(jq -r --argjson index "$implementation_index" '.transactions[$index].hash // empty' "$broadcast_file")"
deployer="$(jq -r --argjson index "$implementation_index" '.transactions[$index].transaction.from // .transactions[$index].from // empty' "$broadcast_file")"
if [[ "$candidate_kind" == "migration" ]]; then
  timelock="$(jq -r --argjson index "$implementation_index" '
    first(.transactions | to_entries[] | select(.key > $index and .value.transactionType == "CREATE" and .value.contractName == "TimelockController"))
    | .value.contractAddress // empty
  ' "$broadcast_file")"
else
  timelock="${CONTENT_PROTECTION_TIMELOCK_ADDRESS:-}"
fi

for pair in "proxy:$proxy" "implementation:$implementation" "timelock:$timelock" "deployer:$deployer" "owner:$owner" "guardian:$guardian"; do
  name="${pair%%:*}"; value="${pair#*:}"
  [[ "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "Error: $name address is missing or malformed." >&2; exit 1; }
done
[[ "$deploy_tx" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "Error: candidate deployment transaction hash is missing or malformed." >&2; exit 1; }
[[ "$delay" =~ ^[0-9]+$ ]] || { echo "Error: delay is missing or malformed." >&2; exit 1; }
if [[ "$network" != "local" ]]; then
  (( delay >= 172800 )) || { echo "Error: remote delay must be at least 172800 seconds." >&2; exit 1; }
  [[ "${owner,,}" != "${guardian,,}" ]] || {
    echo "Error: remote guardian must be independent from owner." >&2
    exit 1
  }
  if [[ "$candidate_kind" == "migration" && "${deployer,,}" == "${guardian,,}" ]]; then
    echo "Error: migration guardian must be independent from the deployment signer." >&2
    exit 1
  fi
fi

block_raw="$(jq -r --arg tx "$deploy_tx" 'first(.receipts[]? | select((.transactionHash // .hash // "") == $tx)) | .blockNumber // empty' "$broadcast_file")"
[[ "$block_raw" =~ ^(0x[0-9a-fA-F]+|[0-9]+)$ ]] || { echo "Error: candidate deployment block missing." >&2; exit 1; }
block_number="$((block_raw))"

mkdir -p "$DEPLOYMENTS_DIR"
record_file="$DEPLOYMENTS_DIR/$record_base.json"
env_file="$DEPLOYMENTS_DIR/$record_base.candidate.env"
abi_file="$DEPLOYMENTS_DIR/content-protection.abi.json"
jq '.abi' "$artifact_file" > "$abi_file"
abi_sha256="$(sha256sum "$abi_file" | awk '{print $1}')"

jq -n \
  --arg network "$network" --argjson chainId "$chain_id" --arg candidateKind "$candidate_kind" --arg status "$status" \
  --arg proxy "$proxy" --arg implementation "$implementation" --arg timelock "$timelock" --arg upgradeSalt "$upgrade_salt" \
  --arg deployer "$deployer" --arg owner "$owner" --arg guardian "$guardian" --argjson delay "$delay" \
  --arg deployTx "$deploy_tx" --argjson blockNumber "$block_number" \
  --arg broadcastFile "${broadcast_file#$PROJECT_ROOT/}" --arg artifactFile "${artifact_file#$PROJECT_ROOT/}" \
  --arg abiFile "${abi_file#$PROJECT_ROOT/}" --arg abiSha256 "$abi_sha256" \
  --arg preparedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '{network:$network,chainId:$chainId,candidateKind:$candidateKind,status:$status,proxy:$proxy,candidateImplementation:$implementation,
    candidateTimelock:$timelock,upgradeSalt:($upgradeSalt | if length == 0 then null else . end),deployer:$deployer,owner:$owner,guardian:$guardian,timelockMinDelaySeconds:$delay,
    preparedAt:$preparedAt,deployment:{transaction:$deployTx,blockNumber:$blockNumber,broadcastFile:$broadcastFile,artifactFile:$artifactFile},
    abi:{file:$abiFile,sha256:$abiSha256}}' > "$record_file"

cat > "$env_file" <<EOF
# ContentProtection $candidate_kind candidate. NOT live until separately approved and executed.
NEXT_PUBLIC_CHAIN_ID=$chain_id
CONTENT_PROTECTION_PROXY=$proxy
NEW_IMPLEMENTATION=$implementation
CONTENT_PROTECTION_TIMELOCK_ADDRESS=$timelock
CONTENT_PROTECTION_OWNER=$owner
CONTENT_PROTECTION_GUARDIAN=$guardian
CONTENT_PROTECTION_TIMELOCK_MIN_DELAY=$delay
CONTENT_PROTECTION_CANDIDATE_KIND=$candidate_kind
CONTENT_PROTECTION_CANDIDATE_STATUS=$status
EOF
if [[ -n "$upgrade_salt" ]]; then
  printf 'CONTENT_PROTECTION_UPGRADE_SALT=%s\n' "$upgrade_salt" >> "$env_file"
fi

echo "ContentProtection $candidate_kind candidate record: $record_file"
echo "ContentProtection $candidate_kind candidate env: $env_file"
echo "ContentProtection ABI handoff: $abi_file"
