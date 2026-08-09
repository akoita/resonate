#!/usr/bin/env bash
set -euo pipefail

contracts_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kernel_dir="${contracts_dir}/lib/kernel"
module_name="lib/ExcessivelySafeCall"

if [[ ! -f "${kernel_dir}/.gitmodules" ]]; then
  echo "Error: Kernel submodule is not initialized at ${kernel_dir}." >&2
  exit 1
fi

if ! git -C "${kernel_dir}" ls-tree --name-only HEAD -- "${module_name}" | grep -Fxq "${module_name}"; then
  exit 0
fi

if git -C "${kernel_dir}" config -f .gitmodules --get-regexp \
  '^submodule\..*\.path$' 2>/dev/null | grep -Fq " ${module_name}"; then
  exit 0
fi

# The pinned Kernel commit contains this gitlink but omitted its .gitmodules
# entry. Repair only the runner checkout so Foundry and actions/checkout can
# traverse submodules without warning; the pinned dependency itself is unchanged.
git -C "${kernel_dir}" config -f .gitmodules \
  submodule."${module_name}".path "${module_name}"
git -C "${kernel_dir}" config -f .gitmodules \
  submodule."${module_name}".url "https://github.com/nomad-xyz/ExcessivelySafeCall"
