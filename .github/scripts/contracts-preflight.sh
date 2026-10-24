#!/usr/bin/env bash
# Preflight for the "Smart Contract Deployment" workflow (contracts-deploy.yml):
# checks the signer, network, and each operation's required inputs before any
# broadcast. Kept out of the workflow file because GitHub caps a step's script
# at 21,000 characters. Inputs come from the step environment:
#   OPERATION, TARGET_NETWORK, DEPLOY_ENVIRONMENT, plus the exported
#   contract variables and secrets the workflow already sets.
set -euo pipefail
requires_signer=true
case "${OPERATION}" in
  smoke-revenue-escrow|verify-revenue-escrow-sourcify|smoke-stem-marketplace|smoke-content-protection) requires_signer=false ;;
esac
if [[ "${requires_signer}" == "true" && -z "${PRIVATE_KEY:-}" ]]; then
  echo "::error::Set CONTRACT_DEPLOYER_PRIVATE_KEY in the contracts-${DEPLOY_ENVIRONMENT} GitHub environment."
  exit 1
fi

lt_uint() {
  local left="${1#0}"
  local right="${2#0}"
  left="${left:-0}"
  right="${right:-0}"
  if [[ ${#left} -ne ${#right} ]]; then
    [[ ${#left} -lt ${#right} ]]
    return
  fi
  [[ "${left}" < "${right}" ]]
}

if [[ "${requires_signer}" == "true" ]]; then
  deployer="$(cast wallet address "${PRIVATE_KEY}")"
else
  deployer="read-only"
fi

case "${OPERATION}" in
  deploy-protocol|deploy-content-protection)
    if [[ -z "${MINT_AUTHORIZER_ADDRESS:-}" ]]; then
      MINT_AUTHORIZER_ADDRESS="${deployer}"
      echo "MINT_AUTHORIZER_ADDRESS=${MINT_AUTHORIZER_ADDRESS}" >> "${GITHUB_ENV}"
    fi
    if [[ "${MINT_AUTHORIZER_ADDRESS,,}" == "0x0000000000000000000000000000000000000000" ]]; then
      echo "::error::MINT_AUTHORIZER_ADDRESS must be non-zero."
      exit 1
    fi
    ;;
esac

case "${OPERATION}" in
  deploy-protocol|deploy-content-protection|prepare-content-protection-v6-migration|execute-content-protection-v6-migration)
    for name in CONTENT_PROTECTION_OWNER CONTENT_PROTECTION_GUARDIAN; do
      if [[ -z "${!name:-}" ]]; then
        echo "::error::${OPERATION} requires ${name} on shared networks."
        exit 1
      fi
    done
    if [[ "${CONTENT_PROTECTION_OWNER,,}" == "${CONTENT_PROTECTION_GUARDIAN,,}" || "${deployer,,}" == "${CONTENT_PROTECTION_GUARDIAN,,}" ]]; then
      echo "::error::CONTENT_PROTECTION_GUARDIAN must be independent from owner and deployer."
      exit 1
    fi
    content_protection_delay="${CONTENT_PROTECTION_TIMELOCK_MIN_DELAY:-172800}"
    if [[ ! "${content_protection_delay}" =~ ^[0-9]+$ ]] || lt_uint "${content_protection_delay}" "172800"; then
      echo "::error::CONTENT_PROTECTION_TIMELOCK_MIN_DELAY must be at least 172800 seconds (48h)."
      exit 1
    fi
    ;;
esac

case "${OPERATION}" in
  deploy-protocol|deploy-content-protection|deploy-revenue-escrow)
    for name in REVENUE_ESCROW_OWNER REVENUE_ESCROW_GUARDIAN; do
      if [[ -z "${!name:-}" ]]; then
        echo "::error::${OPERATION} requires ${name} on shared networks."
        exit 1
      fi
    done
    if [[ "${REVENUE_ESCROW_OWNER,,}" == "${REVENUE_ESCROW_GUARDIAN,,}" ]]; then
      echo "::error::REVENUE_ESCROW_GUARDIAN must be independent from REVENUE_ESCROW_OWNER."
      exit 1
    fi
    if [[ "${deployer,,}" == "${REVENUE_ESCROW_GUARDIAN,,}" ]]; then
      echo "::error::REVENUE_ESCROW_GUARDIAN must be independent from the deployer."
      exit 1
    fi
    revenue_delay="${REVENUE_ESCROW_TIMELOCK_MIN_DELAY:-172800}"
    if [[ ! "${revenue_delay}" =~ ^[0-9]+$ ]] || lt_uint "${revenue_delay}" "172800"; then
      echo "::error::REVENUE_ESCROW_TIMELOCK_MIN_DELAY must be at least 172800 seconds (48h)."
      exit 1
    fi
    ;;
esac

case "${OPERATION}" in
  deploy-protocol|deploy-stem-marketplace)
    required_names=(MARKETPLACE_OWNER MARKETPLACE_GUARDIAN)
    for name in "${required_names[@]}"; do
      if [[ -z "${!name:-}" ]]; then
        echo "::error::${OPERATION} requires ${name} on shared networks."
        exit 1
      fi
    done
    if [[ "${MARKETPLACE_OWNER,,}" == "${MARKETPLACE_GUARDIAN,,}" ]]; then
      echo "::error::MARKETPLACE_GUARDIAN must be independent from MARKETPLACE_OWNER."
      exit 1
    fi
    if [[ "${deployer,,}" == "${MARKETPLACE_GUARDIAN,,}" ]]; then
      echo "::error::MARKETPLACE_GUARDIAN must be independent from the deployer."
      exit 1
    fi
    marketplace_delay="${MARKETPLACE_TIMELOCK_MIN_DELAY:-172800}"
    if [[ ! "${marketplace_delay}" =~ ^[0-9]+$ ]] || lt_uint "${marketplace_delay}" "172800"; then
      echo "::error::MARKETPLACE_TIMELOCK_MIN_DELAY must be at least 172800 seconds (48h)."
      exit 1
    fi
    ;;
esac

case "${OPERATION}" in
  deploy-content-protection)
    if [[ -z "${STEM_NFT_ADDRESS:-}" || -z "${TRANSFER_VALIDATOR_ADDRESS:-}" ]]; then
      echo "::error::deploy-content-protection requires STEM_NFT_ADDRESS and TRANSFER_VALIDATOR_ADDRESS."
      exit 1
    fi
    ;;
  prepare-content-protection-v6-migration)
    if [[ -z "${CONTENT_PROTECTION_PROXY:-}" ]]; then
      echo "::error::${OPERATION} requires CONTENT_PROTECTION_PROXY."
      exit 1
    fi
    ;;
  execute-content-protection-v6-migration|execute-content-protection-upgrade)
    for name in CONTENT_PROTECTION_PROXY CONTENT_PROTECTION_TIMELOCK_ADDRESS NEW_IMPLEMENTATION; do
      if [[ -z "${!name:-}" ]]; then echo "::error::${OPERATION} requires ${name}."; exit 1; fi
    done
    if [[ "${OPERATION}" == "execute-content-protection-v6-migration" ]]; then
      if [[ -z "${MINT_AUTHORIZER_ADDRESS:-}" ]]; then
        echo "::error::execute-content-protection-v6-migration requires MINT_AUTHORIZER_ADDRESS."
        exit 1
      fi
      if [[ "${MINT_AUTHORIZER_ADDRESS,,}" == "0x0000000000000000000000000000000000000000" ]]; then
        echo "::error::execute-content-protection-v6-migration requires a non-zero MINT_AUTHORIZER_ADDRESS."
        exit 1
      fi
    fi
    ;;
  schedule-content-protection-upgrade)
    for name in CONTENT_PROTECTION_PROXY CONTENT_PROTECTION_TIMELOCK_ADDRESS CONTENT_PROTECTION_OWNER CONTENT_PROTECTION_GUARDIAN; do
      if [[ -z "${!name:-}" ]]; then echo "::error::${OPERATION} requires ${name}."; exit 1; fi
    done
    ;;
  backfill-content-protection-stake-escrow)
    if [[ -z "${CONTENT_PROTECTION_PROXY:-}" || -z "${STAKE_ESCROW_TOKEN_IDS:-}" ]]; then
      echo "::error::backfill-content-protection-stake-escrow requires CONTENT_PROTECTION_PROXY and the token_ids input."
      exit 1
    fi
    ;;
  configure-content-protection-stake-lock)
    for name in CONTENT_PROTECTION_PROXY DISPUTE_RESOLUTION_ADDRESS CURATION_REWARDS_ADDRESS; do
      if [[ -z "${!name:-}" ]]; then echo "::error::configure-content-protection-stake-lock requires ${name}."; exit 1; fi
    done
    ;;
  deploy-dispute-stack)
    if [[ -z "${CONTENT_PROTECTION_ADDRESS:-}" && -z "${CONTENT_PROTECTION_PROXY:-}" ]]; then
      echo "::error::deploy-dispute-stack requires CONTENT_PROTECTION_ADDRESS or CONTENT_PROTECTION_PROXY."
      exit 1
    fi
    # The stack being replaced defaults to the environment's current dispute
    # stack, so dispute ids continue from it (#1759).
    if [[ -z "${PREVIOUS_DISPUTE_RESOLUTION_ADDRESS:-}" && -n "${DISPUTE_RESOLUTION_ADDRESS:-}" ]]; then
      PREVIOUS_DISPUTE_RESOLUTION_ADDRESS="${DISPUTE_RESOLUTION_ADDRESS}"
      echo "PREVIOUS_DISPUTE_RESOLUTION_ADDRESS=${PREVIOUS_DISPUTE_RESOLUTION_ADDRESS}" >> "${GITHUB_ENV}"
    fi
    if [[ -z "${PREVIOUS_CURATION_REWARDS_ADDRESS:-}" && -n "${CURATION_REWARDS_ADDRESS:-}" ]]; then
      PREVIOUS_CURATION_REWARDS_ADDRESS="${CURATION_REWARDS_ADDRESS}"
      echo "PREVIOUS_CURATION_REWARDS_ADDRESS=${PREVIOUS_CURATION_REWARDS_ADDRESS}" >> "${GITHUB_ENV}"
    fi
    if [[ -z "${PREVIOUS_DISPUTE_RESOLUTION_ADDRESS:-}" ]]; then
      echo "::error::deploy-dispute-stack requires PREVIOUS_DISPUTE_RESOLUTION_ADDRESS (or DISPUTE_RESOLUTION_ADDRESS) so dispute ids continue on shared networks."
      exit 1
    fi
    if [[ -z "${FEE_RECIPIENT:-}" && -z "${PREVIOUS_CURATION_REWARDS_ADDRESS:-}" ]]; then
      echo "::error::deploy-dispute-stack requires FEE_RECIPIENT or PREVIOUS_CURATION_REWARDS_ADDRESS for the CurationRewards treasury."
      exit 1
    fi
    if [[ -n "${DISPUTE_ID_HEADROOM:-}" && ! "${DISPUTE_ID_HEADROOM}" =~ ^[0-9]+$ ]]; then
      echo "::error::DISPUTE_ID_HEADROOM must be a non-negative integer."
      exit 1
    fi
    ;;
  pause-content-protection)
    if [[ -z "${CONTENT_PROTECTION_PROXY:-}" || -z "${CONTENT_PROTECTION_PAUSED:-}" ]]; then
      echo "::error::pause-content-protection requires CONTENT_PROTECTION_PROXY and CONTENT_PROTECTION_PAUSED."
      exit 1
    fi
    ;;
  smoke-content-protection)
    required_names=(CONTENT_PROTECTION_PROXY CONTENT_PROTECTION_OWNER CONTENT_PROTECTION_DEPLOYER CONTENT_PROTECTION_IMPLEMENTATION CONTENT_PROTECTION_TIMELOCK_ADDRESS CONTENT_PROTECTION_GUARDIAN CONTENT_PROTECTION_TIMELOCK_MIN_DELAY MINT_AUTHORIZER_ADDRESS)
    for name in "${required_names[@]}"; do
      if [[ -z "${!name:-}" ]]; then echo "::error::smoke-content-protection requires ${name}."; exit 1; fi
    done
    if [[ "${MINT_AUTHORIZER_ADDRESS,,}" == "0x0000000000000000000000000000000000000000" ]]; then
      echo "::error::smoke-content-protection requires a non-zero MINT_AUTHORIZER_ADDRESS."
      exit 1
    fi
    ;;
  set-content-protection-stake)
    if [[ -z "${CONTENT_PROTECTION_ADDRESS:-}" ]]; then
      echo "::error::set-content-protection-stake requires CONTENT_PROTECTION_ADDRESS."
      exit 1
    fi
    if [[ -z "${STAKE_ASSET_ADDRESS:-}" && -z "${PAYMENT_USDC_ADDRESS:-}" ]]; then
      echo "::error::set-content-protection-stake requires STAKE_ASSET_ADDRESS or PAYMENT_USDC_ADDRESS."
      exit 1
    fi
    ;;
  deploy-stem-marketplace)
    if [[ -z "${STEM_NFT_ADDRESS:-}" ]]; then
      echo "::error::deploy-stem-marketplace requires STEM_NFT_ADDRESS."
      exit 1
    fi
    if [[ -z "${CONTENT_PROTECTION_ADDRESS:-}" && -z "${CONTENT_PROTECTION_PROXY:-}" ]]; then
      echo "::error::deploy-stem-marketplace requires CONTENT_PROTECTION_ADDRESS or CONTENT_PROTECTION_PROXY."
      exit 1
    fi
    if [[ -z "${PAYMENT_ASSET_REGISTRY_ADDRESS:-}" ]]; then
      echo "::error::deploy-stem-marketplace requires PAYMENT_ASSET_REGISTRY_ADDRESS."
      exit 1
    fi
    if [[ -z "${FEE_RECIPIENT:-}" ]]; then
      echo "::error::deploy-stem-marketplace requires FEE_RECIPIENT on shared networks."
      exit 1
    fi
    ;;
  deploy-show-campaign-escrow)
    required_names=(
      SHOW_CAMPAIGN_ESCROW_OWNER
      SHOW_CAMPAIGN_FEE_RECIPIENT
      SHOW_CAMPAIGN_GUARDIAN
    )
    for name in "${required_names[@]}"; do
      if [[ -z "${!name:-}" ]]; then
        echo "::error::deploy-show-campaign-escrow requires ${name} on shared networks."
        exit 1
      fi
    done
    if [[ "${SHOW_CAMPAIGN_ESCROW_OWNER,,}" == "${SHOW_CAMPAIGN_GUARDIAN,,}" ]]; then
      echo "::error::SHOW_CAMPAIGN_GUARDIAN must be independent from SHOW_CAMPAIGN_ESCROW_OWNER."
      exit 1
    fi
    if [[ "${deployer,,}" == "${SHOW_CAMPAIGN_GUARDIAN,,}" ]]; then
      echo "::error::SHOW_CAMPAIGN_GUARDIAN must be independent from the deployer."
      exit 1
    fi
    timelock_delay="${SHOW_CAMPAIGN_TIMELOCK_MIN_DELAY:-172800}"
    if [[ ! "${timelock_delay}" =~ ^[0-9]+$ ]] || lt_uint "${timelock_delay}" "172800"; then
      echo "::error::SHOW_CAMPAIGN_TIMELOCK_MIN_DELAY must be at least 172800 seconds (48h)."
      exit 1
    fi
    ;;
  set-marketplace-protocol-fee)
    if [[ -z "${MARKETPLACE_ADDRESS:-}" || -z "${NEW_PROTOCOL_FEE_BPS:-}" ]]; then
      echo "::error::set-marketplace-protocol-fee requires MARKETPLACE_ADDRESS and NEW_PROTOCOL_FEE_BPS."
      exit 1
    fi
    ;;
  set-show-campaign-fee-config)
    if [[ -z "${SHOW_CAMPAIGN_ESCROW_ADDRESS:-}" || -z "${NEW_FEE_BPS:-}" || -z "${NEW_FEE_RECIPIENT:-}" ]]; then
      echo "::error::set-show-campaign-fee-config requires SHOW_CAMPAIGN_ESCROW_ADDRESS, NEW_FEE_BPS, and NEW_FEE_RECIPIENT."
      exit 1
    fi
    ;;
  set-show-campaign-confirmer)
    if [[ -z "${SHOW_CAMPAIGN_ESCROW_ADDRESS:-}" || -z "${CONFIRMER_ADDRESS:-}" || -z "${CONFIRMER_ALLOWED:-}" ]]; then
      echo "::error::set-show-campaign-confirmer requires SHOW_CAMPAIGN_ESCROW_ADDRESS, CONFIRMER_ADDRESS, and CONFIRMER_ALLOWED."
      exit 1
    fi
    ;;
  pause-show-campaign-escrow)
    if [[ -z "${SHOW_CAMPAIGN_ESCROW_ADDRESS:-}" || -z "${PAUSED:-}" ]]; then
      echo "::error::pause-show-campaign-escrow requires SHOW_CAMPAIGN_ESCROW_ADDRESS and PAUSED."
      exit 1
    fi
    ;;
  pause-revenue-escrow)
    if [[ -z "${REVENUE_ESCROW_ADDRESS:-}" || -z "${PAUSED:-}" ]]; then
      echo "::error::pause-revenue-escrow requires REVENUE_ESCROW_ADDRESS and PAUSED."
      exit 1
    fi
    ;;
  pause-stem-marketplace)
    if [[ -z "${MARKETPLACE_ADDRESS:-}" || -z "${PAUSED:-}" ]]; then
      echo "::error::pause-stem-marketplace requires MARKETPLACE_ADDRESS and PAUSED."
      exit 1
    fi
    ;;
  schedule-revenue-escrow-upgrade)
    if [[ -z "${REVENUE_ESCROW_ADDRESS:-}" || -z "${REVENUE_ESCROW_TIMELOCK_ADDRESS:-}" ]]; then
      echo "::error::schedule-revenue-escrow-upgrade requires proxy and timelock addresses."
      exit 1
    fi
    ;;
  execute-revenue-escrow-upgrade)
    if [[ -z "${REVENUE_ESCROW_ADDRESS:-}" || -z "${REVENUE_ESCROW_TIMELOCK_ADDRESS:-}" || -z "${NEW_IMPLEMENTATION:-}" ]]; then
      echo "::error::execute-revenue-escrow-upgrade requires proxy, timelock, and NEW_IMPLEMENTATION."
      exit 1
    fi
    ;;
  smoke-revenue-escrow)
    required_names=(REVENUE_ESCROW_ADDRESS REVENUE_ESCROW_OWNER REVENUE_ESCROW_DEPLOYER REVENUE_ESCROW_IMPLEMENTATION REVENUE_ESCROW_TIMELOCK_ADDRESS REVENUE_ESCROW_GUARDIAN REVENUE_ESCROW_PERIOD REVENUE_ESCROW_TIMELOCK_MIN_DELAY)
    for name in "${required_names[@]}"; do
      if [[ -z "${!name:-}" ]]; then echo "::error::smoke-revenue-escrow requires ${name}."; exit 1; fi
    done
    ;;
  schedule-stem-marketplace-upgrade)
    if [[ -z "${MARKETPLACE_ADDRESS:-}" || -z "${MARKETPLACE_TIMELOCK_ADDRESS:-}" ]]; then
      echo "::error::schedule-stem-marketplace-upgrade requires proxy and timelock addresses."
      exit 1
    fi
    ;;
  execute-stem-marketplace-upgrade)
    if [[ -z "${MARKETPLACE_ADDRESS:-}" || -z "${MARKETPLACE_TIMELOCK_ADDRESS:-}" || -z "${NEW_IMPLEMENTATION:-}" ]]; then
      echo "::error::execute-stem-marketplace-upgrade requires proxy, timelock, and NEW_IMPLEMENTATION."
      exit 1
    fi
    ;;
  smoke-stem-marketplace)
    required_names=(MARKETPLACE_ADDRESS MARKETPLACE_OWNER MARKETPLACE_DEPLOYER MARKETPLACE_IMPLEMENTATION MARKETPLACE_TIMELOCK_ADDRESS MARKETPLACE_GUARDIAN MARKETPLACE_TIMELOCK_MIN_DELAY STEM_NFT_ADDRESS CONTENT_PROTECTION_ADDRESS PAYMENT_ASSET_REGISTRY_ADDRESS PROTOCOL_FEE_BPS FEE_RECIPIENT)
    for name in "${required_names[@]}"; do
      if [[ -z "${!name:-}" ]]; then echo "::error::smoke-stem-marketplace requires ${name}."; exit 1; fi
    done
    ;;
  create-show-campaign)
    required_names=(
      SHOW_CAMPAIGN_ESCROW_ADDRESS
      ARTIST_ID_HASH
      AUTHORITY_HASH
      BENEFICIARY
      PAYMENT_TOKEN
      GOAL_UNITS
      MIN_BACKERS
      FUNDING_DEADLINE
      BOOKING_DEADLINE
    )
    for name in "${required_names[@]}"; do
      if [[ -z "${!name:-}" ]]; then
        echo "::error::create-show-campaign requires ${name}."
        exit 1
      fi
    done
    ;;
  confirm-show-campaign-booking)
    if [[ -z "${SHOW_CAMPAIGN_ESCROW_ADDRESS:-}" || -z "${CAMPAIGN_ID:-}" ]]; then
      echo "::error::confirm-show-campaign-booking requires SHOW_CAMPAIGN_ESCROW_ADDRESS and campaign_id."
      exit 1
    fi
    ;;
  confirm-show-campaign-fulfillment)
    if [[ -z "${SHOW_CAMPAIGN_ESCROW_ADDRESS:-}" || -z "${CAMPAIGN_ID:-}" ]]; then
      echo "::error::confirm-show-campaign-fulfillment requires SHOW_CAMPAIGN_ESCROW_ADDRESS and campaign_id."
      exit 1
    fi
    ;;
  release-show-campaign-funds)
    if [[ -z "${SHOW_CAMPAIGN_ESCROW_ADDRESS:-}" || -z "${CAMPAIGN_ID:-}" ]]; then
      echo "::error::release-show-campaign-funds requires SHOW_CAMPAIGN_ESCROW_ADDRESS and campaign_id."
      exit 1
    fi
    ;;
esac

case "${TARGET_NETWORK}" in
  base-sepolia)
    rpc_url="${BASE_SEPOLIA_RPC_URL:-}"
    expected_chain_id="84532"
    minimum_wei="10000000000000000"
    ;;
  sepolia)
    rpc_url="${SEPOLIA_RPC_URL:-}"
    expected_chain_id="11155111"
    minimum_wei="10000000000000000"
    ;;
  *)
    echo "::error::Unsupported network."
    exit 1
    ;;
esac

if [[ -z "${rpc_url}" ]]; then
  echo "::error::Missing RPC URL for ${TARGET_NETWORK}."
  exit 1
fi

chain_id="$(cast chain-id --rpc-url "${rpc_url}")"
if [[ "${chain_id}" != "${expected_chain_id}" ]]; then
  echo "::error::RPC resolved chain ${chain_id}; expected ${expected_chain_id}."
  exit 1
fi

if [[ "${requires_signer}" == "true" ]]; then
  balance_wei="$(cast balance "${deployer}" --rpc-url "${rpc_url}")"
  balance_eth="$(cast from-wei "${balance_wei}")"
  if lt_uint "${balance_wei}" "${minimum_wei}"; then
    echo "::error::Deployer ${deployer} has ${balance_eth} ETH on ${TARGET_NETWORK}; need at least 0.01 ETH."
    exit 1
  fi
else
  balance_eth="not required"
fi

case "${OPERATION}" in
  schedule-content-protection-upgrade|execute-content-protection-upgrade)
    if [[ -n "${CONTENT_PROTECTION_UPGRADE_CALLDATA:-}" && ! "${CONTENT_PROTECTION_UPGRADE_CALLDATA}" =~ ^0x([0-9a-fA-F]{2})*$ ]]; then
      echo "::error::CONTENT_PROTECTION_UPGRADE_CALLDATA must be 0x-prefixed hex (e.g. cast calldata \"reinitializeV7()\")."
      exit 1
    fi
    ;;
esac

case "${OPERATION}" in
  execute-content-protection-v6-migration|pause-content-protection|backfill-content-protection-stake-escrow)
    live_owner="$(cast call "${CONTENT_PROTECTION_PROXY}" 'owner()(address)' --rpc-url "${rpc_url}")"
    if [[ "${live_owner,,}" != "${deployer,,}" ]]; then
      echo "::error::ContentProtection signer ${deployer} is not current owner ${live_owner}."
      exit 1
    fi
    ;;
  schedule-content-protection-upgrade|execute-content-protection-upgrade)
    # Newer cast prints large integers as "172800 [1.728e5]": keep the first token.
    live_delay="$(cast call "${CONTENT_PROTECTION_TIMELOCK_ADDRESS}" 'getMinDelay()(uint256)' --rpc-url "${rpc_url}" | awk '{print $1}')"
    if [[ ! "${live_delay}" =~ ^[0-9]+$ ]] || lt_uint "${live_delay}" "172800"; then
      echo "::error::ContentProtection timelock delay ${live_delay} is below 172800 seconds."
      exit 1
    fi
    if [[ "${OPERATION}" == "schedule-content-protection-upgrade" ]]; then
      role="$(cast call "${CONTENT_PROTECTION_TIMELOCK_ADDRESS}" 'PROPOSER_ROLE()(bytes32)' --rpc-url "${rpc_url}")"
    else
      role="$(cast call "${CONTENT_PROTECTION_TIMELOCK_ADDRESS}" 'EXECUTOR_ROLE()(bytes32)' --rpc-url "${rpc_url}")"
    fi
    allowed="$(cast call "${CONTENT_PROTECTION_TIMELOCK_ADDRESS}" 'hasRole(bytes32,address)(bool)' "${role}" "${deployer}" --rpc-url "${rpc_url}")"
    if [[ "${allowed}" != "true" ]]; then
      echo "::error::Signer ${deployer} does not hold the required ContentProtection timelock role."
      exit 1
    fi
    ;;
  pause-revenue-escrow)
    live_owner="$(cast call "${REVENUE_ESCROW_ADDRESS}" 'owner()(address)' --rpc-url "${rpc_url}")"
    if [[ "${live_owner,,}" != "${deployer,,}" ]]; then
      echo "::error::RevenueEscrow pause signer ${deployer} is not owner ${live_owner}."
      exit 1
    fi
    ;;
  pause-stem-marketplace)
    live_owner="$(cast call "${MARKETPLACE_ADDRESS}" 'owner()(address)' --rpc-url "${rpc_url}")"
    if [[ "${live_owner,,}" != "${deployer,,}" ]]; then
      echo "::error::StemMarketplaceV2 pause signer ${deployer} is not owner ${live_owner}."
      exit 1
    fi
    ;;
  schedule-revenue-escrow-upgrade|execute-revenue-escrow-upgrade)
    if [[ "${OPERATION}" == "schedule-revenue-escrow-upgrade" ]]; then
      role="$(cast call "${REVENUE_ESCROW_TIMELOCK_ADDRESS}" 'PROPOSER_ROLE()(bytes32)' --rpc-url "${rpc_url}")"
    else
      role="$(cast call "${REVENUE_ESCROW_TIMELOCK_ADDRESS}" 'EXECUTOR_ROLE()(bytes32)' --rpc-url "${rpc_url}")"
    fi
    allowed="$(cast call "${REVENUE_ESCROW_TIMELOCK_ADDRESS}" 'hasRole(bytes32,address)(bool)' "${role}" "${deployer}" --rpc-url "${rpc_url}")"
    if [[ "${allowed}" != "true" ]]; then
      echo "::error::Signer ${deployer} does not hold the required RevenueEscrow timelock role."
      exit 1
    fi
    ;;
  schedule-stem-marketplace-upgrade|execute-stem-marketplace-upgrade)
    if [[ "${OPERATION}" == "schedule-stem-marketplace-upgrade" ]]; then
      role="$(cast call "${MARKETPLACE_TIMELOCK_ADDRESS}" 'PROPOSER_ROLE()(bytes32)' --rpc-url "${rpc_url}")"
    else
      role="$(cast call "${MARKETPLACE_TIMELOCK_ADDRESS}" 'EXECUTOR_ROLE()(bytes32)' --rpc-url "${rpc_url}")"
    fi
    allowed="$(cast call "${MARKETPLACE_TIMELOCK_ADDRESS}" 'hasRole(bytes32,address)(bool)' "${role}" "${deployer}" --rpc-url "${rpc_url}")"
    if [[ "${allowed}" != "true" ]]; then
      echo "::error::Signer ${deployer} does not hold the required StemMarketplaceV2 timelock role."
      exit 1
    fi
    ;;
esac

{
  echo "### Contract deployment preflight"
  echo ""
  echo "- environment: \`contracts-${DEPLOY_ENVIRONMENT}\`"
  echo "- target network: \`${TARGET_NETWORK}\`"
  echo "- chain id: \`${chain_id}\`"
  echo "- deployer: \`${deployer}\`"
  echo "- balance: \`${balance_eth} ETH\`"
  echo "- operation: \`${OPERATION}\`"
} >> "${GITHUB_STEP_SUMMARY}"
