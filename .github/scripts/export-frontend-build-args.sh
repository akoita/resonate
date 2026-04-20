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

for key in "${required_vars[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required frontend build variable: ${key}" >&2
    exit 1
  fi
done

for key in "${required_vars[@]}"; do
  printf '%s=%s\n' "${key}" "${!key}"
done
