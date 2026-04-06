#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$SCRIPT_DIR")"

cd "$CONTRACTS_DIR"

install_dep() {
  local path="$1"
  shift

  if [[ -d "$path" ]] && [[ -n "$(find "$path" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    echo "Using existing dependency: $path"
    return
  fi

  forge install "$@" --no-git
}

install_git_dep() {
  local path="$1"
  local repo_url="$2"
  local ref="$3"

  if [[ -d "$path" ]] && [[ -n "$(find "$path" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    echo "Using existing dependency: $path"
    return
  fi

  rm -rf "$path"
  git clone --depth 1 --branch "$ref" --recurse-submodules "$repo_url" "$path"
}

install_dep "lib/forge-std" foundry-rs/forge-std
install_dep "lib/openzeppelin-contracts" openzeppelin/openzeppelin-contracts
# Kernel includes nested submodules (for example FreshCryptoLib). Installing it
# with `forge install --no-git` leaves broken nested git metadata in CI, so we
# clone it as a real git repository with recursive submodules.
install_git_dep "lib/kernel" "https://github.com/zerodevapp/kernel" "v2.4"
install_dep "lib/solady" vectorized/solady
install_dep "lib/ExcessivelySafeCall" nomad-xyz/ExcessivelySafeCall
install_dep "lib/account-abstraction" eth-infinitism/account-abstraction
install_dep "lib/halmos-cheatcodes" a16z/halmos-cheatcodes

if [[ ! -d "lib/kernel/lib/I4337" ]] || [[ -z "$(find "lib/kernel/lib/I4337" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  echo "Cloning kernel dependency: lib/kernel/lib/I4337"
  git clone --depth 1 https://github.com/leekt/I4337 lib/kernel/lib/I4337
fi
