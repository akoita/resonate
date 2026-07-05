#!/usr/bin/env bash
# Parse a StemMarketplaceV2 Forge broadcast and write app/deploy handoff files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACTS_DIR="${CONTRACTS_DIR:-$PROJECT_ROOT/contracts}"
DEPLOYMENTS_DIR="${DEPLOYMENTS_DIR:-$CONTRACTS_DIR/deployments}"

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required to write the StemMarketplaceV2 handoff." >&2
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

broadcast_file="${BROADCAST_FILE:-$CONTRACTS_DIR/broadcast/DeployStemMarketplace.s.sol/$chain_id/run-latest.json}"
artifact_file="${STEM_MARKETPLACE_ARTIFACT:-$CONTRACTS_DIR/out/StemMarketplaceV2.sol/StemMarketplaceV2.json}"

if [[ ! -f "$broadcast_file" ]]; then
  echo "Error: StemMarketplaceV2 broadcast not found: $broadcast_file" >&2
  exit 1
fi

if [[ ! -f "$artifact_file" ]]; then
  echo "Error: StemMarketplaceV2 artifact not found: $artifact_file" >&2
  echo "Run forge build before writing the deployment handoff." >&2
  exit 1
fi

contract_address="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2")
    | .contractAddress
  ' "$broadcast_file" | head -n 1
)"

if [[ -z "$contract_address" || "$contract_address" == "null" ]]; then
  echo "Error: could not find StemMarketplaceV2 CREATE transaction in $broadcast_file" >&2
  exit 1
fi

deploy_tx="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2")
    | .hash // .transactionHash // empty
  ' "$broadcast_file" | head -n 1
)"

deployer="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2")
    | .transaction.from // .from // empty
  ' "$broadcast_file" | head -n 1
)"

if [[ -z "$deployer" && -n "${PRIVATE_KEY:-}" ]] && command -v cast >/dev/null 2>&1; then
  deployer="$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || true)"
fi

stem_nft="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2")
    | .arguments[0] // empty
  ' "$broadcast_file" | head -n 1
)"
stem_nft="${stem_nft:-${STEM_NFT_ADDRESS:-}}"

content_protection="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2")
    | .arguments[1] // empty
  ' "$broadcast_file" | head -n 1
)"
content_protection="${content_protection:-${CONTENT_PROTECTION_ADDRESS:-${CONTENT_PROTECTION_PROXY:-}}}"

payment_asset_registry="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2")
    | .arguments[2] // empty
  ' "$broadcast_file" | head -n 1
)"
payment_asset_registry="${payment_asset_registry:-${PAYMENT_ASSET_REGISTRY_ADDRESS:-}}"

fee_recipient="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2")
    | .arguments[3] // empty
  ' "$broadcast_file" | head -n 1
)"
fee_recipient="${fee_recipient:-${FEE_RECIPIENT:-$deployer}}"

protocol_fee_bps="$(
  jq -r '
    .transactions[]
    | select(.transactionType == "CREATE" and .contractName == "StemMarketplaceV2")
    | .arguments[4] // empty
  ' "$broadcast_file" | head -n 1
)"
protocol_fee_bps="${protocol_fee_bps:-${PROTOCOL_FEE_BPS:-1000}}"

block_number="$(
  jq -r --arg tx "$deploy_tx" '
    .receipts[]?
    | select((.transactionHash // .hash // "") == $tx)
    | .blockNumber // empty
  ' "$broadcast_file" | head -n 1
)"

mkdir -p "$DEPLOYMENTS_DIR"

record_file="$DEPLOYMENTS_DIR/stem-marketplace.$network.json"
remote_env_file="$DEPLOYMENTS_DIR/stem-marketplace.$network.remote.env"
abi_file="$DEPLOYMENTS_DIR/stem-marketplace.abi.json"

jq '.abi' "$artifact_file" > "$abi_file"
abi_sha256="$(sha256sum "$abi_file" | awk '{print $1}')"

jq -n \
  --arg network "$network" \
  --argjson chainId "$chain_id" \
  --arg deployer "$deployer" \
  --argjson protocolFeeBps "$protocol_fee_bps" \
  --arg feeRecipient "$fee_recipient" \
  --arg deployedAt "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  --arg marketplace "$contract_address" \
  --arg stemNft "$stem_nft" \
  --arg contentProtection "$content_protection" \
  --arg paymentAssetRegistry "$payment_asset_registry" \
  --arg deployTx "$deploy_tx" \
  --arg blockNumber "$block_number" \
  --arg broadcastFile "${broadcast_file#$PROJECT_ROOT/}" \
  --arg artifactFile "${artifact_file#$PROJECT_ROOT/}" \
  --arg abiFile "${abi_file#$PROJECT_ROOT/}" \
  --arg abiSha256 "$abi_sha256" \
  '{
    network: $network,
    chainId: $chainId,
    deployer: $deployer,
    feeConfig: {
      protocolFeeBps: $protocolFeeBps,
      feeRecipient: $feeRecipient
    },
    deployedAt: $deployedAt,
    contracts: {
      StemMarketplaceV2: $marketplace,
      StemNFT: $stemNft,
      ContentProtection: $contentProtection,
      PaymentAssetRegistry: $paymentAssetRegistry
    },
    verification: {
      basescan: (if $chainId == 84532 then "https://sepolia.basescan.org/address/" + $marketplace else "" end)
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
# StemMarketplaceV2 deployment handoff for resonate-iac / GCP environments.
# Generated from ${broadcast_file#$PROJECT_ROOT/}.
# No secrets are included. Promote through reviewed environment config before
# app deployment; do not paste private keys or RPC credentials into this file.

NEXT_PUBLIC_CHAIN_ID=$chain_id
MARKETPLACE_ADDRESS=$contract_address
NEXT_PUBLIC_MARKETPLACE_ADDRESS=$contract_address
PROTOCOL_FEE_BPS=$protocol_fee_bps
FEE_RECIPIENT=$fee_recipient
EOF

echo "StemMarketplaceV2 deployment record: $record_file"
echo "StemMarketplaceV2 remote env handoff: $remote_env_file"
echo "StemMarketplaceV2 ABI handoff: $abi_file"
