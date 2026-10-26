#!/usr/bin/env bash
# Parse a DeployDisputeStack broadcast into non-secret handoffs (#1759) and check the
# live wiring of the new DisputeResolution and CurationRewards.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACTS_DIR="${CONTRACTS_DIR:-$PROJECT_ROOT/contracts}"
DEPLOYMENTS_DIR="${DEPLOYMENTS_DIR:-$CONTRACTS_DIR/deployments}"

command -v jq >/dev/null 2>&1 || { echo "Error: jq is required." >&2; exit 1; }
command -v cast >/dev/null 2>&1 || { echo "Error: cast is required." >&2; exit 1; }
[[ -n "${RPC_URL:-}" ]] || { echo "Error: RPC_URL is required to check the deployed wiring." >&2; exit 1; }

chain_id="${CHAIN_ID:-}"
if [[ -z "$chain_id" ]]; then
  chain_id="$(cast chain-id --rpc-url "$RPC_URL")"
fi
case "$chain_id" in
  31337|1337) network="local"; prefix="" ;;
  84532) network="base-sepolia"; prefix="BASE_SEPOLIA_" ;;
  11155111) network="sepolia"; prefix="SEPOLIA_" ;;
  *) network="chain-$chain_id"; prefix="" ;;
esac

broadcast_file="${BROADCAST_FILE:-$CONTRACTS_DIR/broadcast/DeployDisputeStack.s.sol/$chain_id/run-latest.json}"
dr_artifact="${DISPUTE_RESOLUTION_ARTIFACT:-$CONTRACTS_DIR/out/DisputeResolution.sol/DisputeResolution.json}"
cr_artifact="${CURATION_REWARDS_ARTIFACT:-$CONTRACTS_DIR/out/CurationRewards.sol/CurationRewards.json}"
for file in "$broadcast_file" "$dr_artifact" "$cr_artifact"; do
  [[ -f "$file" ]] || { echo "Error: not found: $file" >&2; exit 1; }
done

read_create() {
  local name="$1" field="$2"
  jq -r --arg name "$name" --arg field "$field" \
    'first(.transactions[] | select(.transactionType == "CREATE" and .contractName == $name)) | .[$field] // empty' \
    "$broadcast_file"
}
receipt_block() {
  local tx="$1" raw
  raw="$(jq -r --arg tx "$tx" 'first(.receipts[]? | select((.transactionHash // .hash // "") == $tx)) | .blockNumber // empty' "$broadcast_file")"
  [[ "$raw" =~ ^(0x[0-9a-fA-F]+|[0-9]+)$ ]] || { echo "Error: receipt block missing for $tx." >&2; exit 1; }
  echo "$((raw))"
}
call() { cast call "$1" "$2" --rpc-url "$RPC_URL"; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
is_address() { [[ "$1" =~ ^0x[0-9a-fA-F]{40}$ ]]; }

dispute_resolution="$(read_create DisputeResolution contractAddress)"
curation_rewards="$(read_create CurationRewards contractAddress)"
dr_tx="$(read_create DisputeResolution hash)"
cr_tx="$(read_create CurationRewards hash)"
deployer="$(jq -r 'first(.transactions[] | select(.transactionType == "CREATE" and .contractName == "DisputeResolution")) | .transaction.from // .from // empty' "$broadcast_file")"
for pair in "DisputeResolution:$dispute_resolution" "CurationRewards:$curation_rewards" "deployer:$deployer"; do
  is_address "${pair#*:}" || { echo "Error: ${pair%%:*} address is missing or malformed in $broadcast_file." >&2; exit 1; }
done
[[ "$dr_tx" =~ ^0x[0-9a-fA-F]{64}$ && "$cr_tx" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "Error: deployment transaction hash missing." >&2; exit 1; }
dr_block="$(receipt_block "$dr_tx")"
cr_block="$(receipt_block "$cr_tx")"
deployment_block="$dr_block"
if (( cr_block < deployment_block )); then deployment_block="$cr_block"; fi

# Live wiring: what the indexer and the app will rely on.
content_protection="$(call "$curation_rewards" 'contentProtection()(address)')"
dr_owner="$(call "$dispute_resolution" 'owner()(address)')"
cr_owner="$(call "$curation_rewards" 'owner()(address)')"
treasury="$(call "$curation_rewards" 'treasury()(address)')"
counter_stake_bps="$(call "$curation_rewards" 'counterStakeBps()(uint256)' | awk '{print $1}')"
dispute_id_offset="$(call "$dispute_resolution" 'disputeIdOffset()(uint256)' | awk '{print $1}')"
dispute_count="$(call "$dispute_resolution" 'disputeCount()(uint256)' | awk '{print $1}')"
cr_dispute_resolution="$(call "$curation_rewards" 'disputeResolution()(address)')"
dr_content_protection="$(call "$dispute_resolution" 'contentProtection()(address)')"
dr_filer="$(call "$dispute_resolution" 'disputeFiler()(address)')"
lock_authority="$(call "$content_protection" 'stakeLockAuthority()(address)')"

[[ "$(lower "$cr_dispute_resolution")" == "$(lower "$dispute_resolution")" ]] || { echo "Error: CurationRewards is not bound to the new DisputeResolution." >&2; exit 1; }
[[ "$(lower "$dr_content_protection")" == "$(lower "$content_protection")" ]] || { echo "Error: DisputeResolution stake locking does not target CurationRewards' ContentProtection." >&2; exit 1; }
[[ "$(lower "$dr_filer")" == "$(lower "$curation_rewards")" ]] || { echo "Error: DisputeResolution dispute filer is not the new CurationRewards." >&2; exit 1; }
if [[ -n "${CONTENT_PROTECTION_ADDRESS:-${CONTENT_PROTECTION_PROXY:-}}" ]]; then
  expected_cp="${CONTENT_PROTECTION_ADDRESS:-${CONTENT_PROTECTION_PROXY:-}}"
  [[ "$(lower "$content_protection")" == "$(lower "$expected_cp")" ]] || { echo "Error: the stack is wired to $content_protection, not $expected_cp." >&2; exit 1; }
fi
[[ "$dispute_id_offset" =~ ^[0-9]+$ && "$counter_stake_bps" =~ ^[0-9]+$ ]] || { echo "Error: unreadable offset or counter-stake bps." >&2; exit 1; }

previous_dispute_resolution="${PREVIOUS_DISPUTE_RESOLUTION_ADDRESS:-}"
previous_curation_rewards="${PREVIOUS_CURATION_REWARDS_ADDRESS:-}"
previous_dispute_count=""
if [[ -n "$previous_dispute_resolution" ]]; then
  previous_dispute_count="$(call "$previous_dispute_resolution" 'disputeCount()(uint256)' | awk '{print $1}')"
  # Ids must stay unique per chain: the old stack must not have issued past the offset.
  if [[ ${#previous_dispute_count} -gt ${#dispute_id_offset} || ( ${#previous_dispute_count} -eq ${#dispute_id_offset} && "$previous_dispute_count" > "$dispute_id_offset" ) ]]; then
    echo "Error: the previous DisputeResolution issued id $previous_dispute_count, past the new offset $dispute_id_offset." >&2
    echo "Redeploy with a larger DISPUTE_ID_HEADROOM before switching the app config." >&2
    exit 1
  fi
fi

lock_authority_set=false
[[ "$(lower "$lock_authority")" == "$(lower "$dispute_resolution")" ]] && lock_authority_set=true

mkdir -p "$DEPLOYMENTS_DIR"
record_file="$DEPLOYMENTS_DIR/dispute-stack.$network.json"
env_file="$DEPLOYMENTS_DIR/dispute-stack.$network.remote.env"
dr_abi_file="$DEPLOYMENTS_DIR/dispute-resolution.abi.json"
cr_abi_file="$DEPLOYMENTS_DIR/curation-rewards.abi.json"
jq '.abi' "$dr_artifact" > "$dr_abi_file"
jq '.abi' "$cr_artifact" > "$cr_abi_file"
dr_abi_sha256="$(sha256sum "$dr_abi_file" | awk '{print $1}')"
cr_abi_sha256="$(sha256sum "$cr_abi_file" | awk '{print $1}')"

jq -n \
  --arg network "$network" --argjson chainId "$chain_id" --arg deployer "$deployer" \
  --arg disputeResolution "$dispute_resolution" --arg curationRewards "$curation_rewards" \
  --arg contentProtection "$content_protection" --arg drOwner "$dr_owner" --arg crOwner "$cr_owner" \
  --arg treasury "$treasury" --argjson counterStakeBps "$counter_stake_bps" \
  --argjson disputeIdOffset "$dispute_id_offset" --argjson disputeCount "$dispute_count" \
  --arg previousDisputeResolution "$previous_dispute_resolution" --arg previousCurationRewards "$previous_curation_rewards" \
  --arg previousDisputeCount "$previous_dispute_count" \
  --arg lockAuthority "$lock_authority" --argjson lockAuthoritySet "$lock_authority_set" \
  --arg drTx "$dr_tx" --arg crTx "$cr_tx" --argjson blockNumber "$deployment_block" \
  --arg broadcastFile "${broadcast_file#$PROJECT_ROOT/}" \
  --arg drArtifact "${dr_artifact#$PROJECT_ROOT/}" --arg crArtifact "${cr_artifact#$PROJECT_ROOT/}" \
  --arg drAbiFile "${dr_abi_file#$PROJECT_ROOT/}" --arg drAbiSha256 "$dr_abi_sha256" \
  --arg crAbiFile "${cr_abi_file#$PROJECT_ROOT/}" --arg crAbiSha256 "$cr_abi_sha256" \
  --arg deployedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '{network:$network,chainId:$chainId,deployer:$deployer,deployedAt:$deployedAt,
    contracts:{DisputeResolution:$disputeResolution,CurationRewards:$curationRewards,ContentProtection:$contentProtection},
    owners:{DisputeResolution:$drOwner,CurationRewards:$crOwner},
    config:{treasury:$treasury,counterStakeBps:$counterStakeBps,disputeIdOffset:$disputeIdOffset,
      firstDisputeId:($disputeIdOffset + 1),disputeCount:$disputeCount},
    replaces:{DisputeResolution:$previousDisputeResolution,CurationRewards:$previousCurationRewards,
      disputeCountAtHandoff:$previousDisputeCount},
    stakeLock:{authority:$lockAuthority,authoritySet:$lockAuthoritySet,
      pending:(if $lockAuthoritySet then "" else "configure-content-protection-stake-lock with the ContentProtection owner signer" end)},
    upgradeability:{pattern:"none (replace and continue dispute ids)"},
    deployment:{blockNumber:$blockNumber,disputeResolutionTransaction:$drTx,curationRewardsTransaction:$crTx,
      broadcastFile:$broadcastFile,artifactFiles:[$drArtifact,$crArtifact]},
    abi:{DisputeResolution:{file:$drAbiFile,sha256:$drAbiSha256},CurationRewards:{file:$crAbiFile,sha256:$crAbiSha256}}}' \
  > "$record_file"

{
  echo "# Dispute stack deployment handoff (#1759). No secrets are included."
  echo "NEXT_PUBLIC_CHAIN_ID=$chain_id"
  echo "# Backend indexer and contract operations"
  echo "DISPUTE_RESOLUTION_ADDRESS=$dispute_resolution"
  echo "CURATION_REWARDS_ADDRESS=$curation_rewards"
  if [[ -n "$prefix" ]]; then
    echo "${prefix}DISPUTE_RESOLUTION_ADDRESS=$dispute_resolution"
    echo "${prefix}CURATION_REWARDS_ADDRESS=$curation_rewards"
  fi
  echo "# Frontend (build-time)"
  echo "NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS=$dispute_resolution"
  echo "NEXT_PUBLIC_CURATION_REWARDS_ADDRESS=$curation_rewards"
  if [[ -n "$prefix" ]]; then
    echo "NEXT_PUBLIC_${prefix}DISPUTE_RESOLUTION_ADDRESS=$dispute_resolution"
    echo "NEXT_PUBLIC_${prefix}CURATION_REWARDS_ADDRESS=$curation_rewards"
  fi
  echo "# Records"
  echo "CONTENT_PROTECTION_PROXY=$content_protection"
  echo "DISPUTE_RESOLUTION_OWNER=$dr_owner"
  echo "CURATION_REWARDS_OWNER=$cr_owner"
  echo "DISPUTE_ID_OFFSET=$dispute_id_offset"
  echo "DISPUTE_STACK_DEPLOYMENT_BLOCK=$deployment_block"
  echo "PREVIOUS_DISPUTE_RESOLUTION_ADDRESS=$previous_dispute_resolution"
  echo "PREVIOUS_CURATION_REWARDS_ADDRESS=$previous_curation_rewards"
} > "$env_file"

echo "Dispute stack deployment record: $record_file"
echo "Dispute stack remote env handoff: $env_file"
echo "Dispute stack ABI handoffs: $dr_abi_file, $cr_abi_file"
echo "DISPUTE_STACK_HANDOFF disputeResolution=$dispute_resolution curationRewards=$curation_rewards deploymentBlock=$deployment_block disputeIdOffset=$dispute_id_offset stakeLockAuthoritySet=$lock_authority_set"
if [[ "$lock_authority_set" != "true" ]]; then
  echo "PENDING: run configure-content-protection-stake-lock with the ContentProtection owner signer (current authority: $lock_authority)."
fi
