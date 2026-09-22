#!/usr/bin/env bash
# Print changed web source paths for Vitest's import graph, or a full-suite marker.
set -euo pipefail

if [[ "${WEB_RUN_ALL:-false}" == "true" || "${REPO_SHARED:-false}" == "true" ]]; then
  echo '__FULL_SUITE__'
  exit 0
fi

base_sha="${BASE_SHA:-}"
if [[ -z "${base_sha}" ]] || ! git cat-file -e "${base_sha}^{commit}" 2>/dev/null; then
  echo '__FULL_SUITE__'
  exit 0
fi

changed_file="$(mktemp)"
trap 'rm -f "${changed_file}"' EXIT
repo_root="$(git rev-parse --show-toplevel)"
if ! git -C "${repo_root}" diff --no-renames --name-only -z "${base_sha}...HEAD" -- web > "${changed_file}"; then
  echo '__FULL_SUITE__'
  exit 0
fi

mapfile -d '' -t changed < "${changed_file}"
if (( ${#changed[@]} == 0 )); then
  echo '__FULL_SUITE__'
  exit 0
fi

sources=()
for path in "${changed[@]}"; do
  if [[ "${path}" == *$'\n'* ]]; then
    echo '__FULL_SUITE__'
    exit 0
  fi
  case "${path}" in
    web/src/*.ts|web/src/*.tsx|web/src/*/*.ts|web/src/*/*.tsx)
      if [[ -f "${path#web/}" ]]; then
        sources+=("${path#web/}")
      else
        # Deletions can affect importing tests even though Vitest cannot read
        # the deleted file to reconstruct its old dependency graph.
        echo '__FULL_SUITE__'
        exit 0
      fi
      ;;
    web/src/*)
      # Styling, assets, and generated inputs are not reliably in Vitest's graph.
      echo '__FULL_SUITE__'
      exit 0
      ;;
    *)
      # Package, config, route/build inputs, and unknown files affect all tests.
      echo '__FULL_SUITE__'
      exit 0
      ;;
  esac
done

printf '%s\n' "${sources[@]}" | sort -u
