#!/usr/bin/env bash

set -euo pipefail

required_vars=(
  NEXT_PUBLIC_API_URL
  NEXT_PUBLIC_ZERODEV_PROJECT_ID
  NEXT_PUBLIC_CHAIN_ID
  NEXT_PUBLIC_STEM_NFT_ADDRESS
  NEXT_PUBLIC_MARKETPLACE_ADDRESS
  NEXT_PUBLIC_TRANSFER_VALIDATOR_ADDRESS
  NEXT_PUBLIC_CONTENT_PROTECTION_ADDRESS
  NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS
  NEXT_PUBLIC_CURATION_REWARDS_ADDRESS
)

# Optional vars: emitted with their current value (which may be empty)
# so a missing GitHub `vars.*` setting doesn't fail the build. Used for
# the in-app About modal + environment badge — production stays silent
# when NEXT_PUBLIC_ENV is unset.
optional_vars=(
  NEXT_PUBLIC_ENV
  NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS
)

validate_contract_handoff() {
  local handoff_file="${FRONTEND_CONTRACT_DEPLOYMENT_ENV_FILE:-}"
  if [[ -z "${handoff_file}" ]]; then
    return
  fi

  if [[ ! -f "${handoff_file}" ]]; then
    echo "Frontend contract handoff file not found: ${handoff_file}" >&2
    exit 1
  fi

  local contract_vars=(
    NEXT_PUBLIC_STEM_NFT_ADDRESS
    NEXT_PUBLIC_MARKETPLACE_ADDRESS
    NEXT_PUBLIC_TRANSFER_VALIDATOR_ADDRESS
    NEXT_PUBLIC_CONTENT_PROTECTION_ADDRESS
    NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS
    NEXT_PUBLIC_CURATION_REWARDS_ADDRESS
  )

  local key expected actual
  for key in "${contract_vars[@]}"; do
    expected="$(grep -E "^${key}=" "${handoff_file}" | tail -n 1 | cut -d= -f2-)"
    actual="${!key:-}"
    if [[ -z "${expected}" ]]; then
      echo "Missing ${key} in frontend contract handoff file: ${handoff_file}" >&2
      exit 1
    fi
    if [[ "${actual,,}" != "${expected,,}" ]]; then
      echo "Frontend contract variable ${key}=${actual} does not match ${handoff_file} (${expected})." >&2
      exit 1
    fi
  done
}

validate_show_campaign_handoff() {
  local handoff_file="${FRONTEND_SHOW_CAMPAIGN_DEPLOYMENT_ENV_FILE:-}"
  if [[ -z "${handoff_file}" ]]; then
    return
  fi

  if [[ ! -f "${handoff_file}" ]]; then
    echo "ShowCampaignEscrow handoff file not found: ${handoff_file}" >&2
    exit 1
  fi

  local key="NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS"
  local expected actual
  expected="$(grep -E "^${key}=" "${handoff_file}" | tail -n 1 | cut -d= -f2-)"
  actual="${!key:-}"

  if [[ -z "${expected}" ]]; then
    echo "Missing ${key} in ShowCampaignEscrow handoff file: ${handoff_file}" >&2
    exit 1
  fi
  if [[ -z "${actual}" ]]; then
    echo "Missing optional frontend build variable required by ${handoff_file}: ${key}" >&2
    exit 1
  fi
  if [[ "${actual,,}" != "${expected,,}" ]]; then
    echo "Frontend contract variable ${key}=${actual} does not match ${handoff_file} (${expected})." >&2
    exit 1
  fi
}

for key in "${required_vars[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required frontend build variable: ${key}" >&2
    exit 1
  fi
done

validate_contract_handoff
validate_show_campaign_handoff

for key in "${required_vars[@]}"; do
  printf '%s=%s\n' "${key}" "${!key}"
done

for key in "${optional_vars[@]}"; do
  printf '%s=%s\n' "${key}" "${!key:-}"
done
