#!/usr/bin/env bash

set -euo pipefail

suite="${1:-}"
if [[ -z "${suite}" ]]; then
  echo "usage: $0 <unit|integration>" >&2
  exit 1
fi

if [[ "${suite}" != "unit" && "${suite}" != "integration" ]]; then
  echo "unsupported suite: ${suite}" >&2
  exit 1
fi

run_full_suite() {
  echo "__FULL_SUITE__"
  exit 0
}

if [[ "${BACKEND_RUN_ALL:-false}" == "true" || "${REPO_SHARED:-false}" == "true" || "${BACKEND_SHARED:-false}" == "true" ]]; then
  run_full_suite
fi

tests=()

add_tests() {
  tests+=("$@")
}

add_identity_tests() {
  if [[ "${suite}" == "unit" ]]; then
    add_tests \
      "src/tests/auth.controller.http.spec.ts" \
      "src/tests/auth.controller.spec.ts" \
      "src/tests/auth.spec.ts" \
      "src/modules/identity/zerodev_session_key.spec.ts" \
      "src/tests/erc6492.spec.ts" \
      "src/tests/roles.guard.spec.ts" \
      "src/tests/session_key.spec.ts" \
      "src/tests/sessions.controller.http.spec.ts" \
      "src/tests/sessions.controller.spec.ts" \
      "src/tests/social_recovery.spec.ts" \
      "src/tests/wallet.controller.http.spec.ts" \
      "src/tests/wallet.controller.spec.ts"
  else
    add_tests \
      "src/tests/erc4337_client.integration.spec.ts" \
      "src/tests/flow3_session.integration.spec.ts" \
      "src/tests/sessions.integration.spec.ts" \
      "src/tests/wallet.integration.spec.ts"
  fi
}

add_ingestion_tests() {
  if [[ "${suite}" == "unit" ]]; then
    add_tests \
      "src/tests/encryption.spec.ts" \
      "src/tests/ingestion.controller.http.spec.ts" \
      "src/tests/ingestion.controller.spec.ts" \
      "src/tests/ingestion_metadata.spec.ts" \
      "src/tests/ingestion_stem_type.spec.ts" \
      "src/tests/pubsub-runtime.spec.ts" \
      "src/tests/release-pipeline.spec.ts" \
      "src/tests/separation-progress.regression.spec.ts" \
      "src/tests/stem-result.subscriber.spec.ts" \
      "src/tests/stems-processor-pubsub.spec.ts" \
      "src/tests/upload-rights-policy.spec.ts"
  else
    add_tests \
      "src/tests/asset_persistence.integration.spec.ts" \
      "src/tests/demucs_integration.spec.ts" \
      "src/tests/fingerprint.service.integration.spec.ts" \
      "src/tests/flow1_ingestion.integration.spec.ts" \
      "src/tests/ingestion_api_metadata.integration.spec.ts" \
      "src/tests/stem-pubsub.integration.spec.ts" \
      "src/tests/stem-watchdog.integration.spec.ts" \
      "src/tests/stems-processor.integration.spec.ts" \
      "src/tests/storage.integration.spec.ts" \
      "src/tests/upload-rights-routing.integration.spec.ts"
  fi
}

add_catalog_tests() {
  if [[ "${suite}" == "unit" ]]; then
    add_tests \
      "src/tests/catalog.controller.http.spec.ts" \
      "src/tests/catalog.controller.spec.ts" \
      "src/modules/contracts/human-verification.service.spec.ts" \
      "src/tests/stem-pricing.controller.spec.ts"
  else
    add_tests \
      "src/tests/catalog.integration.spec.ts" \
      "src/tests/contracts.integration.spec.ts" \
      "src/tests/flow2_contracts.integration.spec.ts" \
      "src/tests/indexer.integration.spec.ts" \
      "src/tests/metadata.controller.integration.spec.ts" \
      "src/tests/stem-pricing.integration.spec.ts"
  fi
}

add_generation_tests() {
  if [[ "${suite}" == "unit" ]]; then
    add_tests \
      "src/modules/agents/agent_purchase.spec.ts" \
      "src/modules/agents/agent_wallet.spec.ts" \
      "src/tests/agent_evaluation.spec.ts" \
      "src/tests/agent_golden_eval.spec.ts" \
      "src/tests/agents.spec.ts" \
      "src/tests/embeddings.spec.ts" \
      "src/tests/generation.controller.http.spec.ts" \
      "src/tests/generation.controller.spec.ts" \
      "src/tests/lyria_client.spec.ts" \
      "src/tests/openapi.controller.spec.ts"
  else
    add_tests \
      "src/tests/agent_orchestration.integration.spec.ts" \
      "src/tests/agent_orchestrator.integration.spec.ts" \
      "src/tests/agent_purchase_strict.integration.spec.ts" \
      "src/tests/agent_runtime.integration.spec.ts" \
      "src/tests/flow4_generation.integration.spec.ts" \
      "src/tests/generation.integration.spec.ts" \
      "src/tests/tool_declarations.integration.spec.ts"
  fi
}

add_marketplace_tests() {
  if [[ "${suite}" == "unit" ]]; then
    add_tests \
      "src/tests/analytics.spec.ts" \
      "src/tests/artist.controller.spec.ts" \
      "src/tests/curation.spec.ts" \
      "src/modules/notifications/notification.service.spec.ts" \
      "src/tests/payments.spec.ts" \
      "src/tests/playlist.controller.http.spec.ts" \
      "src/tests/playlist.controller.spec.ts" \
      "src/tests/pricing.spec.ts" \
      "src/tests/recommendations.controller.spec.ts" \
      "src/tests/remix.spec.ts" \
      "src/tests/rights-evidence.spec.ts" \
      "src/tests/storefront.service.spec.ts" \
      "src/tests/trust-tier-config.spec.ts" \
      "src/tests/trust.controller.spec.ts" \
      "src/tests/verification-semantics.spec.ts" \
      "src/tests/x402.config.spec.ts" \
      "src/tests/x402.controller.http.spec.ts" \
      "src/tests/x402.controller.spec.ts" \
      "src/tests/x402.middleware.spec.ts" \
      "src/tests/x402.quote.spec.ts" \
      "src/tests/x402.receipt.spec.ts"
  else
    add_tests \
      "src/tests/artist.integration.spec.ts" \
      "src/tests/curator-reputation.integration.spec.ts" \
      "src/tests/dmca.service.integration.spec.ts" \
      "src/tests/playlist.integration.spec.ts" \
      "src/tests/recommendations.integration.spec.ts"
  fi
}

if [[ "${BACKEND_IDENTITY:-false}" == "true" ]]; then
  add_identity_tests
fi

if [[ "${BACKEND_INGESTION:-false}" == "true" ]]; then
  add_ingestion_tests
fi

if [[ "${BACKEND_CATALOG:-false}" == "true" ]]; then
  add_catalog_tests
fi

if [[ "${BACKEND_GENERATION:-false}" == "true" ]]; then
  add_generation_tests
fi

if [[ "${BACKEND_MARKETPLACE:-false}" == "true" ]]; then
  add_marketplace_tests
fi

if [[ ${#tests[@]} -eq 0 ]]; then
  run_full_suite
fi

printf '%s\n' "${tests[@]}" | awk '!seen[$0]++'
