#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$SCRIPT_DIR")"

KERNEL_V4_AA_COMMIT="86fcd84cf7263fe384d61d078ee747b16e69a496"
# The application profile targets EntryPoint v0.7. This literal is a guard, not
# a pin: the lib/account-abstraction gitlink must equal it, so a gitlink moved
# off v0.7 (for example by a Dependabot submodule bump) fails here instead of
# silently building a different EntryPoint.
ACCOUNT_ABSTRACTION_V07_COMMIT="7af70c8993a6f42973f520ae0752386a5032abe7"

cd "$CONTRACTS_DIR"

# The root repository gitlinks are the single source of truth for every pin in
# lib/ (and .gitmodules for every repository URL), so this script, Dependabot's
# submodule bumps and `git submodule update --init --checkout` can never
# disagree: what a gitlink records is exactly what CI builds and tests. Bump a
# pin with `git -C contracts/lib/<dep> checkout <sha> && git add contracts/lib/<dep>`
# and update contracts/foundry.lock to match.
gitlink_commit() {
  local path="$1"
  local commit
  commit="$(git ls-files --stage -- "$path" | awk '$1 == "160000" { print $2; exit }')"
  if [[ -z "$commit" ]]; then
    echo "Error: $path is not a gitlink in this checkout; cannot resolve its pinned commit." >&2
    return 1
  fi
  echo "$commit"
}

gitmodules_url() {
  local path="$1"
  local url
  url="$(git config --file ../.gitmodules --get "submodule.contracts/$path.url" || true)"
  if [[ -z "$url" ]]; then
    echo "Error: no url for contracts/$path in .gitmodules." >&2
    return 1
  fi
  echo "$url"
}

install_pinned_dep() {
  local path="$1"
  local repo_url
  local expected_commit
  repo_url="$(gitmodules_url "$path")"
  expected_commit="$(gitlink_commit "$path")"
  local absolute_path="$CONTRACTS_DIR/$path"
  local actual_root=""
  local actual_commit=""

  if [[ -d "$path" ]] && [[ -n "$(find "$path" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    actual_root="$(git -C "$path" rev-parse --show-toplevel 2>/dev/null || true)"
    if [[ "$actual_root" != "$absolute_path" ]]; then
      echo "Error: $path contains an unmanaged dependency checkout." >&2
      echo "Move that generated directory aside, then rerun this script; local changes are never deleted automatically." >&2
      return 1
    fi
  else
    git clone --depth 1 --no-recurse-submodules "$repo_url" "$path"
  fi

  actual_commit="$(git -C "$path" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$actual_commit" != "$expected_commit" ]]; then
    git -C "$path" fetch --depth 1 origin "$expected_commit"
    git -C "$path" checkout --detach "$expected_commit"
  fi

  actual_commit="$(git -C "$path" rev-parse HEAD)"
  if [[ "$actual_commit" != "$expected_commit" ]]; then
    echo "Error: $path is at $actual_commit; expected pinned commit $expected_commit." >&2
    return 1
  fi
  echo "Using pinned dependency: $path @ $actual_commit"
}

install_kernel_v4_dependencies() {
  local kernel_v4_project="kernel-v4"

  if [[ ! -f "$kernel_v4_project/foundry.toml" || ! -f "$kernel_v4_project/soldeer.lock" ]]; then
    echo "Error: isolated Kernel v4 project metadata is missing." >&2
    return 1
  fi

  (
    cd "$kernel_v4_project"
    forge soldeer install --config-location foundry
  )

  local aa_path="$kernel_v4_project/dependencies/eth-infinitism-account-abstraction-0.9.0"
  local actual_aa_commit
  actual_aa_commit="$(git -C "$aa_path" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$actual_aa_commit" != "$KERNEL_V4_AA_COMMIT" ]]; then
    echo "Error: isolated Kernel v4 AA dependency is at $actual_aa_commit; expected pinned commit $KERNEL_V4_AA_COMMIT." >&2
    return 1
  fi
}

# Installing exact SHAs avoids Foundry silently following a newer default branch
# in clean runners. Every SHA comes from the root gitlink of the same path.
AA_GITLINK_COMMIT="$(gitlink_commit "lib/account-abstraction")"
if [[ "$AA_GITLINK_COMMIT" != "$ACCOUNT_ABSTRACTION_V07_COMMIT" ]]; then
  echo "Error: lib/account-abstraction gitlink is $AA_GITLINK_COMMIT; the EntryPoint v0.7 profile requires $ACCOUNT_ABSTRACTION_V07_COMMIT (v0.7.0)." >&2
  echo "Restore it with: git -C contracts/lib/account-abstraction checkout $ACCOUNT_ABSTRACTION_V07_COMMIT && git add contracts/lib/account-abstraction" >&2
  exit 1
fi

for dep in \
  lib/forge-std \
  lib/openzeppelin-contracts \
  lib/openzeppelin-contracts-upgradeable \
  lib/kernel \
  lib/kernel-v3 \
  lib/solady \
  lib/ExcessivelySafeCall \
  lib/account-abstraction \
  lib/halmos-cheatcodes; do
  install_pinned_dep "$dep"
done

install_kernel_v4_dependencies
