#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$SCRIPT_DIR")"
KERNEL_REPO_URL="https://github.com/zerodevapp/kernel"
KERNEL_V4_COMMIT="f2a84a332ec5a722e7e95a0d64601905c3c87fe9"
KERNEL_V3_COMMIT="e00c66aa82f6d04809c908d2df27d0bac64785ff"
KERNEL_V4_AA_COMMIT="86fcd84cf7263fe384d61d078ee747b16e69a496"

cd "$CONTRACTS_DIR"

strip_git_metadata() {
  local root="$1"

  if [[ ! -d "$root" ]]; then
    return
  fi

  while IFS= read -r -d '' path; do
    rm -rf "$path"
  done < <(find "$root" \( -name .git -o -name .gitmodules \) -print0)
}

install_dep() {
  local path="$1"
  shift

  if [[ -d "$path" ]] && [[ -n "$(find "$path" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    echo "Using existing dependency: $path"
    strip_git_metadata "$path"
    return
  fi

  forge install "$@" --no-git
  strip_git_metadata "$path"
}

install_git_dep() {
  local path="$1"
  local repo_url="$2"
  local expected_commit="$3"

  if [[ -d "$path" ]] && [[ -n "$(find "$path" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    echo "Using existing dependency: $path"
  else
    rm -rf "$path"
    # Do not recurse here: the legacy v2.4 .gitmodules file omitted one of its
    # gitlinks. Repair the runner metadata first, then initialize the exact
    # nested commits below.
    git clone --depth 1 --no-recurse-submodules "$repo_url" "$path"
    git -C "$path" fetch --depth 1 origin "$expected_commit"
    git -C "$path" checkout --detach "$expected_commit"
  fi

  local actual_commit
  actual_commit="$(git -C "$path" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$actual_commit" != "$expected_commit" ]]; then
    echo "Error: $path is at $actual_commit; expected pinned commit $expected_commit." >&2
    return 1
  fi

  "$SCRIPT_DIR/repair-kernel-submodule-metadata.sh"
}

install_legacy_kernel_submodules() {
  local kernel_v3="lib/kernel-v3"

  # The v2.4 compatibility checkout carries its own pinned dependency
  # gitlinks. Initialize those exact commits only after repairing its missing
  # Ex...SafeCall metadata entry. The root runtime only imports I4337; the
  # other legacy nested modules are intentionally left unopened.
  git -C "$kernel_v3" submodule update --init --checkout lib/I4337
}

install_kernel_v4_dependencies() {
  local kernel_v4_project="kernel-v4"

  if [[ ! -f "$kernel_v4_project/foundry.toml" || ! -f "$kernel_v4_project/soldeer.lock" ]]; then
    echo "Error: isolated Kernel v4 project metadata is missing." >&2
    return 1
  fi

  # The isolated project carries the upstream v4 soldeer lock. Soldeer verifies
  # registry checksums/integrity and checks out the AA git dependency at the
  # revision recorded in that lock instead of following a floating branch.
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

install_dep "lib/forge-std" foundry-rs/forge-std
install_dep "lib/openzeppelin-contracts" openzeppelin/openzeppelin-contracts
# Kernel v4 is the verified primary dependency. Existing first-party runtime
# imports remain on the explicit v2.4 compatibility checkout below.
install_git_dep "lib/kernel" "$KERNEL_REPO_URL" "$KERNEL_V4_COMMIT"
install_git_dep "lib/kernel-v3" "$KERNEL_REPO_URL" "$KERNEL_V3_COMMIT"
install_legacy_kernel_submodules
install_kernel_v4_dependencies
install_dep "lib/solady" vectorized/solady
install_dep "lib/ExcessivelySafeCall" nomad-xyz/ExcessivelySafeCall
install_dep "lib/account-abstraction" eth-infinitism/account-abstraction
install_dep "lib/halmos-cheatcodes" a16z/halmos-cheatcodes
