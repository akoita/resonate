#!/usr/bin/env bash
# Parse a ShowCampaignEscrow Forge broadcast and write app/deploy handoff files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACTS_DIR="${CONTRACTS_DIR:-$PROJECT_ROOT/contracts}"
DEPLOYMENTS_DIR="${DEPLOYMENTS_DIR:-$CONTRACTS_DIR/deployments}"

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required to write the ShowCampaignEscrow handoff." >&2
  exit 1
fi

chain_id="${CHAIN_ID:-}"
if [[ -z "$chain_id" && -n "${RPC_URL:-}" ]]; then
  if command -v cast >/dev/null 2>&1; then
    chain_id="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || true)"
  fi
fi
chain_id="${chain_id:-84532}"

case "$chain_id" in
  31337) network="local" ;;
  84532) network="base-sepolia" ;;
  11155111) network="sepolia" ;;
  *) network="chain-$chain_id" ;;
esac

broadcast_file="${BROADCAST_FILE:-$CONTRACTS_DIR/broadcast/DeployShowCampaignEscrow.s.sol/$chain_id/run-latest.json}"
artifact_file="${SHOW_CAMPAIGN_ESCROW_ARTIFACT:-$CONTRACTS_DIR/out/ShowCampaignEscrow.sol/ShowCampaignEscrow.json}"

if [[ ! -f "$broadcast_file" ]]; then
  echo "Error: ShowCampaignEscrow broadcast not found: $broadcast_file" >&2
  exit 1
fi

if [[ ! -f "$artifact_file" ]]; then
  echo "Error: ShowCampaignEscrow artifact not found: $artifact_file" >&2
  echo "Run forge build before writing the deployment handoff." >&2
  exit 1
fi

# The app-facing address is the ERC1967 PROXY, not the UUPS implementation. The
# DeployShowCampaignEscrow script emits three CREATEs: the implementation
# (contractName "ShowCampaignEscrow"), the "TimelockController" upgrade authority,
# and the "ERC1967Proxy". Record all three; SHOW_CAMPAIGN_ESCROW_ADDRESS is the proxy.
contract_address="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "ERC1967Proxy")
    | .contractAddress
  ' "$broadcast_file" | head -n 1
)"

if [[ -z "$contract_address" || "$contract_address" == "null" ]]; then
  echo "Error: could not find ERC1967Proxy CREATE transaction in $broadcast_file" >&2
  echo "The escrow is deployed behind a proxy; expected an ERC1967Proxy CREATE." >&2
  exit 1
fi

implementation_address="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "ShowCampaignEscrow")
    | .contractAddress
  ' "$broadcast_file" | head -n 1
)"

timelock_address="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "TimelockController")
    | .contractAddress
  ' "$broadcast_file" | head -n 1
)"

if [[ -z "$implementation_address" || "$implementation_address" == "null" ]]; then
  echo "Error: could not find ShowCampaignEscrow implementation CREATE in $broadcast_file" >&2
  exit 1
fi

if [[ -z "$timelock_address" || "$timelock_address" == "null" ]]; then
  echo "Error: could not find TimelockController CREATE in $broadcast_file" >&2
  exit 1
fi

deploy_tx="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "ERC1967Proxy")
    | .hash // .transactionHash // empty
  ' "$broadcast_file" | head -n 1
)"

if [[ -z "$deploy_tx" || "$deploy_tx" == "null" ]]; then
  echo "Error: proxy deployment transaction hash is missing from $broadcast_file" >&2
  exit 1
fi

deployer="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "ERC1967Proxy")
    | .transaction.from // .from // empty
  ' "$broadcast_file" | head -n 1
)"

if [[ -z "$deployer" && -n "${PRIVATE_KEY:-}" ]] && command -v cast >/dev/null 2>&1; then
  deployer="$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || true)"
fi

owner="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "ShowCampaignEscrow")
    | .arguments[0] // empty
  ' "$broadcast_file" | head -n 1
)"
owner="${owner:-${SHOW_CAMPAIGN_ESCROW_OWNER:-$deployer}}"

fee_bps="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "ShowCampaignEscrow")
    | .arguments[1] // empty
  ' "$broadcast_file" | head -n 1
)"
fee_bps="${fee_bps:-${SHOW_CAMPAIGN_FEE_BPS:-600}}"

fee_recipient="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "ShowCampaignEscrow")
    | .arguments[2] // empty
  ' "$broadcast_file" | head -n 1
)"
fee_recipient="${fee_recipient:-${SHOW_CAMPAIGN_FEE_RECIPIENT:-$owner}}"

guardian="${SHOW_CAMPAIGN_GUARDIAN:-}"
timelock_min_delay="${SHOW_CAMPAIGN_TIMELOCK_MIN_DELAY:-172800}"
fulfillment_window="${SHOW_CAMPAIGN_FULFILLMENT_WINDOW:-2592000}"

if [[ "$network" != "local" && -z "$guardian" ]]; then
  echo "Error: SHOW_CAMPAIGN_GUARDIAN is required for shared-network handoffs." >&2
  exit 1
fi
guardian="${guardian:-$owner}"

for named_address in \
  "deployer:$deployer" \
  "owner:$owner" \
  "fee recipient:$fee_recipient" \
  "guardian:$guardian" \
  "proxy:$contract_address" \
  "implementation:$implementation_address" \
  "timelock:$timelock_address"; do
  name="${named_address%%:*}"
  value="${named_address#*:}"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "Error: $name address is missing or malformed in the deployment handoff." >&2
    exit 1
  fi
done

for named_uint in \
  "fee BPS:$fee_bps" \
  "timelock delay:$timelock_min_delay" \
  "fulfillment window:$fulfillment_window"; do
  name="${named_uint%%:*}"
  value="${named_uint#*:}"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "Error: $name is missing or malformed in the deployment handoff." >&2
    exit 1
  fi
done

block_number_raw="$(
  jq -r --arg tx "$deploy_tx" '
    .receipts[]?
    | select((.transactionHash // .hash // "") == $tx)
    | .blockNumber // empty
  ' "$broadcast_file" | head -n 1
)"

if [[ ! "$block_number_raw" =~ ^(0x[0-9a-fA-F]+|[0-9]+)$ ]]; then
  echo "Error: proxy deployment block is missing or malformed in $broadcast_file" >&2
  exit 1
fi
block_number="$((block_number_raw))"

mkdir -p "$DEPLOYMENTS_DIR"

record_file="$DEPLOYMENTS_DIR/show-campaign-escrow.$network.json"
remote_env_file="$DEPLOYMENTS_DIR/show-campaign-escrow.$network.remote.env"
abi_file="$DEPLOYMENTS_DIR/show-campaign-escrow.abi.json"

jq '.abi' "$artifact_file" > "$abi_file"
abi_sha256="$(sha256sum "$abi_file" | awk '{print $1}')"

jq -n \
  --arg network "$network" \
  --argjson chainId "$chain_id" \
  --arg deployer "$deployer" \
  --arg owner "$owner" \
  --argjson feeBps "$fee_bps" \
  --arg feeRecipient "$fee_recipient" \
  --arg guardian "$guardian" \
  --argjson timelockMinDelay "$timelock_min_delay" \
  --argjson fulfillmentWindow "$fulfillment_window" \
  --arg deployedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg address "$contract_address" \
  --arg implementation "$implementation_address" \
  --arg timelock "$timelock_address" \
  --arg deployTx "$deploy_tx" \
  --argjson blockNumber "$block_number" \
  --arg broadcastFile "${broadcast_file#$PROJECT_ROOT/}" \
  --arg artifactFile "${artifact_file#$PROJECT_ROOT/}" \
  --arg abiFile "${abi_file#$PROJECT_ROOT/}" \
  --arg abiSha256 "$abi_sha256" \
  '{
    network: $network,
    chainId: $chainId,
    deployer: $deployer,
    owner: $owner,
    feeConfig: {
      feeBps: $feeBps,
      feeRecipient: $feeRecipient
    },
    deployedAt: $deployedAt,
    contracts: {
      ShowCampaignEscrow: $address,
      ShowCampaignEscrowImplementation: $implementation,
      ShowCampaignEscrowTimelock: $timelock
    },
    upgradeability: {
      pattern: "UUPS-ERC1967",
      proxy: $address,
      implementation: $implementation,
      upgradeAuthority: $timelock
    },
    governance: {
      owner: $owner,
      guardian: $guardian,
      timelock: $timelock,
      timelockMinDelaySeconds: $timelockMinDelay,
      deployerAdminRenounced: true
    },
    lifecycle: {
      fulfillmentWindowSeconds: $fulfillmentWindow
    },
    verification: {
      blockscout: (if $chainId == 84532 then "https://base-sepolia.blockscout.com/address/" + $address + "?tab=contract" else "" end),
      sourcify: {
        proxy: (if $chainId == 84532 then "https://repo.sourcify.dev/84532/" + $address else "" end),
        implementation: (if $chainId == 84532 then "https://repo.sourcify.dev/84532/" + $implementation else "" end),
        timelock: (if $chainId == 84532 then "https://repo.sourcify.dev/84532/" + $timelock else "" end)
      }
    },
    deployment: {
      transaction: $deployTx,
      blockNumber: $blockNumber,
      broadcastFile: $broadcastFile,
      artifactFile: $artifactFile
    },
    abi: {
      file: $abiFile,
      sha256: $abiSha256
    }
  }' > "$record_file"

cat > "$remote_env_file" <<EOF
# ShowCampaignEscrow deployment handoff for resonate-iac / GCP environments.
# Generated from ${broadcast_file#$PROJECT_ROOT/}.
# No secrets are included. Promote through reviewed environment config before
# app deployment; do not paste private keys or RPC credentials into this file.

NEXT_PUBLIC_CHAIN_ID=$chain_id
# App-facing address is the ERC1967 proxy (stable across upgrades).
SHOW_CAMPAIGN_ESCROW_ADDRESS=$contract_address
NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS=$contract_address
# Exact replay origin for this proxy. During a replacement cutover, merge this
# entry with every legacy address that still has unsettled campaigns.
SHOW_CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK=$block_number
SHOW_CAMPAIGN_ESCROW_INDEXER_TARGETS=$contract_address:$block_number
SHOW_CAMPAIGN_ESCROW_OWNER=$owner
SHOW_CAMPAIGN_ESCROW_DEPLOYER=$deployer
# Upgrade authority (TimelockController) — input for UpgradeShowCampaignEscrow.
SHOW_CAMPAIGN_TIMELOCK_ADDRESS=$timelock_address
SHOW_CAMPAIGN_ESCROW_IMPLEMENTATION=$implementation_address
SHOW_CAMPAIGN_TIMELOCK_MIN_DELAY=$timelock_min_delay
SHOW_CAMPAIGN_GUARDIAN=$guardian
SHOW_CAMPAIGN_FULFILLMENT_WINDOW=$fulfillment_window
SHOW_CAMPAIGN_FEE_BPS=$fee_bps
SHOW_CAMPAIGN_FEE_RECIPIENT=$fee_recipient
EOF

echo "ShowCampaignEscrow deployment record: $record_file"
echo "ShowCampaignEscrow remote env handoff: $remote_env_file"
echo "ShowCampaignEscrow ABI handoff: $abi_file"
