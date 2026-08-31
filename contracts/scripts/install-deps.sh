#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$SCRIPT_DIR")"

KERNEL_REPO_URL="https://github.com/zerodevapp/kernel"
KERNEL_V4_COMMIT="f2a84a332ec5a722e7e95a0d64601905c3c87fe9"
KERNEL_V3_COMMIT="03f7f5cf5871cda0070e4223f196f5b577f6cde2"
KERNEL_V4_AA_COMMIT="86fcd84cf7263fe384d61d078ee747b16e69a496"
ACCOUNT_ABSTRACTION_V07_COMMIT="7af70c8993a6f42973f520ae0752386a5032abe7"

cd "$CONTRACTS_DIR"

install_pinned_dep() {
  local path="$1"
  local repo_url="$2"
  local expected_commit="$3"
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

# These commits are the root repository gitlinks. Installing their exact SHAs
# avoids Foundry silently following a newer default branch in clean runners.
install_pinned_dep "lib/forge-std" \
  "https://github.com/foundry-rs/forge-std" \
  "bf647bd6046f2f7da30d0c2bf435e5c76a780c1b"
install_pinned_dep "lib/openzeppelin-contracts" \
  "https://github.com/OpenZeppelin/openzeppelin-contracts" \
  "fddac901ccdbdb06be90536822936ea765dd9218"
install_pinned_dep "lib/openzeppelin-contracts-upgradeable" \
  "https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable" \
  "d8c717774cfa3a0396dd3e94db58b7580218651e"
install_pinned_dep "lib/kernel" "$KERNEL_REPO_URL" "$KERNEL_V4_COMMIT"
install_pinned_dep "lib/kernel-v3" "$KERNEL_REPO_URL" "$KERNEL_V3_COMMIT"
install_pinned_dep "lib/solady" \
  "https://github.com/Vectorized/solady" \
  "cedd7936a11807acd819c9f6acf48fdcefee3f73"
install_pinned_dep "lib/ExcessivelySafeCall" \
  "https://github.com/nomad-xyz/ExcessivelySafeCall" \
  "81cd99ce3e69117d665d7601c330ea03b97acce0"
install_pinned_dep "lib/account-abstraction" \
  "https://github.com/eth-infinitism/account-abstraction" \
  "$ACCOUNT_ABSTRACTION_V07_COMMIT"
install_pinned_dep "lib/halmos-cheatcodes" \
  "https://github.com/a16z/halmos-cheatcodes" \
  "6da4e692c357ba6d641a2e677a28298cac9f76ab"

install_kernel_v4_dependencies
