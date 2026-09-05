#!/usr/bin/env bash
# Classify the checked-out CI revision. Called by ci.yml and exercised with real
# temporary Git repositories in tests/test_ci_change_detection.py.
# Inputs: EVENT_NAME, REF_NAME, BASE_SHA, optional HEAD_REF/RELEASE_VALIDATION.
# Output paths: GITHUB_OUTPUT and GITHUB_STEP_SUMMARY (provided by the runner).
set -euo pipefail

backend=false
demucs=false
stable_audio=false
analytics_dataflow=false
backend_identity=false
backend_ingestion=false
backend_catalog=false
backend_generation=false
backend_marketplace=false
backend_shared=false
desktop=false
web=false
contracts=false
shared=false
shared_image=false
docs=false
infra=false
run_all=false
main_post_merge=false

if [[ "${RELEASE_VALIDATION:-false}" == "true" ]]; then
  # Reusable callers retain their original event. Release validation must win
  # over the ordinary main-push receipt optimization.
  run_all=true
  echo "Release-scoped reusable invocation; running the complete validation graph."
elif [[ "${EVENT_NAME}" == "push" && "${REF_NAME}" == "main" ]]; then
  main_post_merge=true
  echo "Main post-merge receipt; skipping duplicate application validation."
fi

if [[ "${EVENT_NAME}" == "pull_request" ]]; then
  base_sha="${BASE_SHA:-}"
  if [[ "${HEAD_REF:-}" == mergify/merge-queue/* ]]; then
    run_all=true
    echo "Mergify queue PR; running the full validation safety net."
  fi
elif [[ "${EVENT_NAME}" == "merge_group" ]]; then
  base_sha="${BASE_SHA:-}"
  run_all=true
  echo "GitHub merge queue candidate detected; running the full validation safety net once for the queued batch."
elif [[ "${EVENT_NAME}" == "push" && "${REF_NAME}" == mergify/merge-queue/* ]]; then
  base_sha="${BASE_SHA:-}"
  run_all=true
  echo "Mergify queue branch detected; running the full validation safety net once for the queued batch."
else
  base_sha="${BASE_SHA:-}"
fi

if [[ -z "${base_sha}" || "${base_sha}" == "0000000000000000000000000000000000000000" ]]; then
  echo "Unable to determine diff base safely; running full CI."
  run_all=true
elif ! git cat-file -e "${base_sha}^{commit}" 2>/dev/null; then
  echo "Base commit ${base_sha} is not available locally; running full CI."
  run_all=true
fi

if [[ "${run_all}" == "false" ]]; then
  # Capture the exit status: process substitution would hide a failed diff.
  # NUL delimiters preserve unusual filenames; disabling rename detection makes
  # a move out of a runtime directory still validate the deleted source path.
  changed_paths_file="$(mktemp)"
  trap 'rm -f "${changed_paths_file}"' EXIT
  if ! git diff --no-renames --name-only -z "${base_sha}...HEAD" -- > "${changed_paths_file}"; then
    echo "Unable to compute the changed paths; running full CI."
    run_all=true
  fi
  mapfile -d '' -t changed_files < "${changed_paths_file}"

  if [[ "${run_all}" == "true" ]]; then
    : # Preserve the conservative fallback on any diff failure.
  elif [[ ${#changed_files[@]} -eq 0 ]]; then
    echo "No changed files detected from git diff; running full CI."
    run_all=true
  else
    printf 'Changed files:\n%s\n' "${changed_files[@]}"

    # Keep this mapping conservative: ambiguous changes should land in
    # "shared" so the full cross-module safety net still runs.
    # "shared_image" is the narrower subset of "shared" that can
    # actually change what ends up inside a container image; it gates
    # the release image-publish fan-out only (see the reusable image
    # publisher workflow).
    for file in "${changed_files[@]}"; do
      case "${file}" in
        AGENTS.md|CLAUDE.md|GEMINI.md|backend/AGENTS.md|backend/CLAUDE.md|backend/GEMINI.md|backend/TESTING.md|backend/README.md|contracts/AGENTS.md|contracts/CLAUDE.md|contracts/GEMINI.md|contracts/README.md|web/AGENTS.md|web/CLAUDE.md|web/GEMINI.md|web/README.md|desktop/AGENTS.md|desktop/CLAUDE.md|desktop/GEMINI.md|desktop/README.md|.claude/settings.json|.claude/skills|.gemini/commands/*.toml|.github/CODEOWNERS|.github/ISSUE_TEMPLATE/*|.github/PULL_REQUEST_TEMPLATE*)
          # Non-runtime documentation and agent/client metadata. Unknown scripts
          # and runtime Markdown still follow their package or shared fallback.
          # Security Scan continues to review every PR independently.
          docs=true
          ;;
        backend/src/modules/auth/*|backend/src/modules/identity/*|backend/src/modules/sessions/*|backend/src/modules/webauthn/*|backend/src/tests/auth.*|backend/src/tests/sessions.*|backend/src/tests/wallet.*|backend/src/tests/session_key.spec.ts|backend/src/tests/erc4337_client.integration.spec.ts|backend/src/tests/erc6492.spec.ts|backend/src/tests/roles.guard.spec.ts|backend/src/tests/social_recovery.spec.ts)
          backend=true
          backend_identity=true
          ;;
        backend/src/modules/ingestion/*|backend/src/modules/storage/*|backend/src/modules/encryption/*|backend/src/modules/fingerprint/*|backend/src/tests/asset_persistence.integration.spec.ts|backend/src/tests/demucs_integration.spec.ts|backend/src/tests/encryption.spec.ts|backend/src/tests/fingerprint.service.integration.spec.ts|backend/src/tests/flow1_ingestion.integration.spec.ts|backend/src/tests/ingestion*|backend/src/tests/pubsub-runtime.spec.ts|backend/src/tests/release-pipeline.spec.ts|backend/src/tests/separation-progress.regression.spec.ts|backend/src/tests/stem-*|backend/src/tests/stems-*|backend/src/tests/storage.integration.spec.ts|backend/src/tests/upload-rights-policy.spec.ts|backend/src/tests/upload-rights-routing.integration.spec.ts)
          backend=true
          backend_ingestion=true
          ;;
        backend/src/modules/catalog/*|backend/src/modules/contracts/*|backend/src/modules/library/*|backend/src/tests/catalog.*|backend/src/tests/contracts.integration.spec.ts|backend/src/tests/flow2_contracts.integration.spec.ts|backend/src/tests/indexer.integration.spec.ts|backend/src/tests/metadata.controller.integration.spec.ts|backend/src/tests/stem-pricing.*)
          backend=true
          backend_catalog=true
          ;;
        backend/src/evals/*|backend/src/modules/agents/*|backend/src/modules/embeddings/*|backend/src/modules/generation/*|backend/src/modules/openapi/*|backend/src/tests/agent_*|backend/src/tests/agents.spec.ts|backend/src/tests/embeddings.spec.ts|backend/src/tests/flow4_generation.integration.spec.ts|backend/src/tests/generation.*|backend/src/tests/lyria_client.spec.ts|backend/src/tests/openapi.controller.spec.ts|backend/src/tests/tool_declarations.integration.spec.ts)
          backend=true
          backend_generation=true
          ;;
        backend/src/modules/mcp/*|backend/src/tests/mcp.*)
          backend=true
          backend_marketplace=true
          # MCP constants are also consumed by the OpenAPI
          # well-known document and the ERC-8004 agent registration
          # file, both covered by the generation group.
          backend_generation=true
          ;;
        backend/src/modules/analytics/*|backend/src/modules/artist/*|backend/src/modules/curation/*|backend/src/modules/dmca/*|backend/src/modules/notifications/*|backend/src/modules/payments/*|backend/src/modules/playlist/*|backend/src/modules/pricing/*|backend/src/modules/recommendations/*|backend/src/modules/remix/*|backend/src/modules/rights/*|backend/src/modules/storefront/*|backend/src/modules/trust/*|backend/src/modules/x402/*|backend/src/tests/analytics.spec.ts|backend/src/tests/artist.*|backend/src/tests/curation.spec.ts|backend/src/tests/curator-reputation.integration.spec.ts|backend/src/tests/dmca.service.integration.spec.ts|backend/src/tests/payments.spec.ts|backend/src/tests/playlist.*|backend/src/tests/pricing.spec.ts|backend/src/tests/recommendations.*|backend/src/tests/remix.spec.ts|backend/src/tests/rights-evidence.spec.ts|backend/src/tests/storefront.service.spec.ts|backend/src/tests/trust-*|backend/src/tests/trust.controller.spec.ts|backend/src/tests/verification-semantics.spec.ts|backend/src/tests/x402.*)
          backend=true
          backend_marketplace=true
          ;;
        backend/jest*|backend/package-lock.json|backend/package.json|backend/prisma/*|backend/src/main.ts|backend/src/modules/audit/*|backend/src/modules/health/*|backend/src/modules/maintenance/*|backend/src/modules/shared/*|backend/src/tests/event_bus.spec.ts|backend/src/tests/global*|backend/src/tests/health.integration.spec.ts|backend/src/tests/prisma_postgres.integration.spec.ts|backend/src/tests/testcontainers.setup.ts)
          backend=true
          backend_shared=true
          ;;
        backend/*)
          backend=true
          backend_shared=true
          ;;
        desktop/*)
          desktop=true
          ;;
        workers/demucs/*)
          demucs=true
          ;;
        workers/stable-audio/*)
          stable_audio=true
          ;;
        workers/analytics-dataflow/*)
          analytics_dataflow=true
          ;;
        web/*)
          web=true
          ;;
        .npmrc|.github/actions/*|scripts/*)
          # Composite actions and scripts/.npmrc are inputs to the
          # release-scoped image build, so classify them as shared
          # image inputs for downstream release planning.
          shared=true
          shared_image=true
          ;;
        contracts/*)
          contracts=true
          ;;
        docs/*|*.md)
          docs=true
          ;;
        infra/*|terraform/*)
          infra=true
          ;;
        .github/workflows/ci.yml)
          # This workflow owns the image build contexts, Dockerfile
          # paths and build args, so editing it can change what is
          # baked into an image.
          shared=true
          shared_image=true
          ;;
        .github/workflows/*)
          # Every other workflow (deploy dispatch, security, formal,
          # mutation, desktop release, staging drills, …) only changes
          # how CI/CD runs, never the contents of a container image.
          # They keep the conservative "shared" test fan-out but must
          # NOT force an image rebuild: the stable-audio ML worker
          # image alone takes ~29 minutes to build, and a one-line edit
          # to e.g. deploy-handoff.yml used to rebuild all four images.
          shared=true
          ;;
        package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|tsconfig*.json|eslint.config.*|.eslintrc*|turbo.json|Makefile|docker-compose*.yml|docker-compose*.yaml)
          shared=true
          shared_image=true
          ;;
        *)
          # Unknown files stay conservative on both flags.
          shared=true
          shared_image=true
          ;;
      esac
    done
  fi
fi

docs_only=false
# Infra-only and docs-only changes can skip module-specific jobs, but
# anything that doesn't classify cleanly falls back to a full run.
if [[ "${run_all}" == "false" && "${backend}" == "false" && "${demucs}" == "false" && "${stable_audio}" == "false" && "${analytics_dataflow}" == "false" && "${desktop}" == "false" && "${web}" == "false" && "${contracts}" == "false" && "${shared}" == "false" ]]; then
  if [[ "${docs}" == "true" || "${infra}" == "true" ]]; then
    docs_only=true
  else
    echo "Change classification was empty or ambiguous; running full CI."
    run_all=true
  fi
fi

echo "backend=${backend}" >> "${GITHUB_OUTPUT}"
echo "demucs=${demucs}" >> "${GITHUB_OUTPUT}"
echo "stable_audio=${stable_audio}" >> "${GITHUB_OUTPUT}"
echo "analytics_dataflow=${analytics_dataflow}" >> "${GITHUB_OUTPUT}"
echo "backend_identity=${backend_identity}" >> "${GITHUB_OUTPUT}"
echo "backend_ingestion=${backend_ingestion}" >> "${GITHUB_OUTPUT}"
echo "backend_catalog=${backend_catalog}" >> "${GITHUB_OUTPUT}"
echo "backend_generation=${backend_generation}" >> "${GITHUB_OUTPUT}"
echo "backend_marketplace=${backend_marketplace}" >> "${GITHUB_OUTPUT}"
echo "backend_shared=${backend_shared}" >> "${GITHUB_OUTPUT}"
echo "desktop=${desktop}" >> "${GITHUB_OUTPUT}"
echo "web=${web}" >> "${GITHUB_OUTPUT}"
echo "contracts=${contracts}" >> "${GITHUB_OUTPUT}"
echo "shared=${shared}" >> "${GITHUB_OUTPUT}"
echo "shared_image=${shared_image}" >> "${GITHUB_OUTPUT}"
echo "docs_only=${docs_only}" >> "${GITHUB_OUTPUT}"
echo "run_all=${run_all}" >> "${GITHUB_OUTPUT}"
echo "main_post_merge=${main_post_merge}" >> "${GITHUB_OUTPUT}"

{
  echo "### Change detection"
  echo ""
  echo "- backend: ${backend}"
  echo "- demucs: ${demucs}"
  echo "- stable_audio: ${stable_audio}"
  echo "- analytics_dataflow: ${analytics_dataflow}"
  echo "- backend_identity: ${backend_identity}"
  echo "- backend_ingestion: ${backend_ingestion}"
  echo "- backend_catalog: ${backend_catalog}"
  echo "- backend_generation: ${backend_generation}"
  echo "- backend_marketplace: ${backend_marketplace}"
  echo "- backend_shared: ${backend_shared}"
  echo "- desktop: ${desktop}"
  echo "- web: ${web}"
  echo "- contracts: ${contracts}"
  echo "- shared: ${shared}"
  echo "- shared_image: ${shared_image}"
  echo "- docs_only: ${docs_only}"
  echo "- run_all: ${run_all}"
  echo "- main_post_merge: ${main_post_merge}"
} >> "${GITHUB_STEP_SUMMARY}"
