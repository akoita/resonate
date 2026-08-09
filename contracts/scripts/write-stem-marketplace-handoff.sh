#!/usr/bin/env bash
# Parse a guarded StemMarketplaceV2 deployment broadcast into non-secret handoffs.

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

broadcast_file="${BROADCAST_FILE:-$CONTRACTS_DIR/broadcast/DeployStemMarketplace.s.sol/$chain_id/run-latest.json}"
artifact_file="${STEM_MARKETPLACE_ARTIFACT:-$CONTRACTS_DIR/out/StemMarketplaceV2.sol/StemMarketplaceV2.json}"
[[ -f "$broadcast_file" ]] || { echo "Error: broadcast not found: $broadcast_file" >&2; exit 1; }
[[ -f "$artifact_file" ]] || { echo "Error: artifact not found: $artifact_file" >&2; exit 1; }

read_create() {
  local name="$1" field="$2"
  jq -r --arg name "$name" --arg field "$field" \
    'first(.transactions[] | select(.transactionType == "CREATE" and .contractName == $name)) | .[$field] // empty' \
    "$broadcast_file"
}

proxy="$(read_create ERC1967Proxy contractAddress)"
implementation="$(read_create StemMarketplaceV2 contractAddress)"
timelock="$(read_create TimelockController contractAddress)"
deploy_tx="$(read_create ERC1967Proxy hash)"
deployer="$(jq -r 'first(.transactions[] | select(.transactionType == "CREATE" and .contractName == "ERC1967Proxy")) | .transaction.from // .from // empty' "$broadcast_file")"
if [[ -z "$deployer" && -n "${PRIVATE_KEY:-}" ]] && command -v cast >/dev/null 2>&1; then
  deployer="$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || true)"
fi

owner="${MARKETPLACE_OWNER:-$deployer}"
guardian="${MARKETPLACE_GUARDIAN:-$owner}"
delay="${MARKETPLACE_TIMELOCK_MIN_DELAY:-172800}"
stem_nft="${STEM_NFT_ADDRESS:-}"
content_protection="${CONTENT_PROTECTION_ADDRESS:-${CONTENT_PROTECTION_PROXY:-}}"
payment_asset_registry="${PAYMENT_ASSET_REGISTRY_ADDRESS:-}"
fee_recipient="${FEE_RECIPIENT:-$deployer}"
protocol_fee_bps="${PROTOCOL_FEE_BPS:-1000}"

if [[ "$network" != "local" && -z "${MARKETPLACE_GUARDIAN:-}" ]]; then
  echo "Error: MARKETPLACE_GUARDIAN is required for shared-network handoffs." >&2
  exit 1
fi
for pair in \
  "proxy:$proxy" "implementation:$implementation" "timelock:$timelock" "deployer:$deployer" \
  "owner:$owner" "guardian:$guardian" "stemNFT:$stem_nft" "contentProtection:$content_protection" \
  "paymentAssetRegistry:$payment_asset_registry" "feeRecipient:$fee_recipient"; do
  name="${pair%%:*}"; value="${pair#*:}"
  [[ "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "Error: $name address is missing or malformed." >&2; exit 1; }
done
for pair in "protocolFeeBps:$protocol_fee_bps" "delay:$delay"; do
  name="${pair%%:*}"; value="${pair#*:}"
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "Error: $name is missing or malformed." >&2; exit 1; }
done

block_raw="$(jq -r --arg tx "$deploy_tx" 'first(.receipts[]? | select((.transactionHash // .hash // "") == $tx)) | .blockNumber // empty' "$broadcast_file")"
[[ "$block_raw" =~ ^(0x[0-9a-fA-F]+|[0-9]+)$ ]] || { echo "Error: deployment block missing." >&2; exit 1; }
block_number="$((block_raw))"

mkdir -p "$DEPLOYMENTS_DIR"
record_file="$DEPLOYMENTS_DIR/stem-marketplace.$network.json"
env_file="$DEPLOYMENTS_DIR/stem-marketplace.$network.remote.env"
abi_file="$DEPLOYMENTS_DIR/stem-marketplace.abi.json"
jq '.abi' "$artifact_file" > "$abi_file"
abi_sha256="$(sha256sum "$abi_file" | awk '{print $1}')"

jq -n \
  --arg network "$network" --argjson chainId "$chain_id" --arg deployer "$deployer" \
  --arg owner "$owner" --arg guardian "$guardian" --argjson delay "$delay" \
  --arg proxy "$proxy" --arg implementation "$implementation" --arg timelock "$timelock" \
  --arg stemNft "$stem_nft" --arg contentProtection "$content_protection" \
  --arg paymentAssetRegistry "$payment_asset_registry" --arg feeRecipient "$fee_recipient" \
  --argjson protocolFeeBps "$protocol_fee_bps" --arg deployTx "$deploy_tx" \
  --argjson blockNumber "$block_number" --arg broadcastFile "${broadcast_file#$PROJECT_ROOT/}" \
  --arg artifactFile "${artifact_file#$PROJECT_ROOT/}" --arg abiFile "${abi_file#$PROJECT_ROOT/}" \
  --arg abiSha256 "$abi_sha256" --arg deployedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '{network:$network,chainId:$chainId,deployer:$deployer,owner:$owner,guardian:$guardian,
    feeConfig:{protocolFeeBps:$protocolFeeBps,feeRecipient:$feeRecipient},deployedAt:$deployedAt,
    contracts:{StemMarketplaceV2:$proxy,StemMarketplaceV2Implementation:$implementation,
      StemMarketplaceV2Timelock:$timelock,StemNFT:$stemNft,ContentProtection:$contentProtection,
      PaymentAssetRegistry:$paymentAssetRegistry},
    upgradeability:{pattern:"UUPS-ERC1967",proxy:$proxy,implementation:$implementation,upgradeAuthority:$timelock},
    governance:{owner:$owner,guardian:$guardian,timelock:$timelock,timelockMinDelaySeconds:$delay,deployerAdminRenounced:true},
    verification:{sourcify:(if $chainId == 84532 then "https://repo.sourcify.dev/84532/" + $proxy else "" end),
      blockscout:(if $chainId == 84532 then "https://base-sepolia.blockscout.com/address/" + $proxy + "?tab=contract" else "" end)},
    deployment:{transaction:$deployTx,blockNumber:$blockNumber,broadcastFile:$broadcastFile,artifactFile:$artifactFile},
    abi:{file:$abiFile,sha256:$abiSha256}}' > "$record_file"

cat > "$env_file" <<EOF
# StemMarketplaceV2 guarded UUPS deployment handoff. No secrets are included.
NEXT_PUBLIC_CHAIN_ID=$chain_id
# App-facing address is always the stable ERC1967 proxy.
MARKETPLACE_ADDRESS=$proxy
NEXT_PUBLIC_MARKETPLACE_ADDRESS=$proxy
MARKETPLACE_IMPLEMENTATION=$implementation
MARKETPLACE_TIMELOCK_ADDRESS=$timelock
MARKETPLACE_OWNER=$owner
MARKETPLACE_DEPLOYER=$deployer
MARKETPLACE_GUARDIAN=$guardian
MARKETPLACE_TIMELOCK_MIN_DELAY=$delay
MARKETPLACE_PAUSED=false
STEM_NFT_ADDRESS=$stem_nft
CONTENT_PROTECTION_ADDRESS=$content_protection
PAYMENT_ASSET_REGISTRY_ADDRESS=$payment_asset_registry
PROTOCOL_FEE_BPS=$protocol_fee_bps
FEE_RECIPIENT=$fee_recipient
MARKETPLACE_DEPLOYMENT_BLOCK=$block_number
EOF

echo "StemMarketplaceV2 deployment record: $record_file"
echo "StemMarketplaceV2 remote env handoff: $env_file"
echo "StemMarketplaceV2 ABI handoff: $abi_file"
