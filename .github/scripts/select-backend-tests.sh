#!/usr/bin/env bash

# Print changed backend source paths for Jest's related-test selection, or a
# full-suite marker when the change cannot be selected safely.
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

if ! repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  run_full_suite
fi

base_sha="${BASE_SHA:-}"
if [[ ! "${base_sha}" =~ ^([[:xdigit:]]{40}|[[:xdigit:]]{64})$ ]] || \
   ! git -C "${repo_root}" cat-file -e "${base_sha}^{commit}" 2>/dev/null; then
  run_full_suite
fi

changed_file="$(mktemp)" || run_full_suite
trap 'rm -f "${changed_file}"' EXIT
if ! git -C "${repo_root}" diff --no-renames --name-status -z \
  "${base_sha}...HEAD" -- backend > "${changed_file}"; then
  run_full_suite
fi

mapfile -d '' -t changes < "${changed_file}"
if (( ${#changes[@]} == 0 || ${#changes[@]} % 2 != 0 )); then
  run_full_suite
fi

sources=()
for ((index = 0; index < ${#changes[@]}; index += 2)); do
  status="${changes[index]}"
  path="${changes[index + 1]}"

  # A removed or type-changed file cannot be passed reliably to Jest's import
  # graph, and unexpected status records may hide a path we cannot classify.
  case "${status}" in
    A|M) ;;
    *) run_full_suite ;;
  esac

  # Output is line-delimited for the workflow's mapfile, so unusual names are
  # safer to handle with the complete suite.
  if [[ "${path}" == *$'\n'* ]]; then
    run_full_suite
  fi

  case "${path}" in
    backend/prisma|backend/prisma/*|\
    backend/jest*|backend/package*|backend/npm-shrinkwrap.json|backend/yarn.lock|\
    backend/pnpm-lock.yaml|backend/src/main.ts|backend/src/tests/globalSetup.*|\
    backend/src/tests/globalTeardown.*|backend/src/tests/testcontainers.setup.*)
      run_full_suite
      ;;
    backend/src/*)
      case "${path##*.}" in
        ts|tsx|js|jsx|mts|cts|mjs|cjs) ;;
        *) run_full_suite ;;
      esac

      if [[ "${path}" == backend/src/modules/shared/* && "${path}" != *.spec.ts ]] || \
         [[ "${path}" == backend/src/db/prisma* && "${path}" != *.spec.ts ]]; then
        run_full_suite
      fi

      if [[ ! -f "${repo_root}/${path}" ]]; then
        run_full_suite
      fi
      sources+=("src/${path#backend/src/}")
      ;;
    backend/*)
      # Unknown backend files may affect test setup, builds, or runtime
      # behavior outside Jest's source import graph.
      run_full_suite
      ;;
    *)
      # Changes outside backend source do not provide a usable Jest input.
      run_full_suite
      ;;
  esac
done

if (( ${#sources[@]} == 0 )); then
  run_full_suite
fi

printf '%s\n' "${sources[@]}" | LC_ALL=C sort -u
