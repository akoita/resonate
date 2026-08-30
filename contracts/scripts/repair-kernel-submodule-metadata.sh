#!/usr/bin/env bash
set -euo pipefail

contracts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

repair_kernel_metadata() {
  local kernel_dir="$1"
  local module_name="lib/ExcessivelySafeCall"

  # Kernel v4 has no nested gitlinks. The v2.4 compatibility checkout does,
  # and its pinned commit omitted the Ex...SafeCall .gitmodules entry.
  if [[ ! -f "${kernel_dir}/.gitmodules" ]] || \
    ! git -C "${kernel_dir}" rev-parse --git-dir >/dev/null 2>&1; then
    return
  fi

  if ! git -C "${kernel_dir}" ls-tree --name-only HEAD -- "${module_name}" |
    grep -Fxq "${module_name}"; then
    return
  fi

  if git -C "${kernel_dir}" config -f .gitmodules --get-regexp \
    '^submodule\..*\.path$' 2>/dev/null | grep -Fq " ${module_name}"; then
    return
  fi

  # Repair only the runner checkout so Foundry and actions/checkout can
  # traverse the legacy nested submodule; the pinned dependency is unchanged.
  git -C "${kernel_dir}" config -f .gitmodules \
    submodule."${module_name}".path "${module_name}"
  git -C "${kernel_dir}" config -f .gitmodules \
    submodule."${module_name}".url "https://github.com/nomad-xyz/ExcessivelySafeCall"
}

repair_kernel_metadata "${contracts_dir}/lib/kernel"
repair_kernel_metadata "${contracts_dir}/lib/kernel-v3"
