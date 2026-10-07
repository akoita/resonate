#!/usr/bin/env bash
# Compile a generated Dataform root tree with the pinned Dataform CLI (#2115).
#
# Usage: check_dataform_root_tree.sh <tree_dir>
#
# Requires the pinned CLI to be installed first:
#   node scripts/hardened-npm-install.mjs --project workers/analytics-dataflow/dataform-cli
# Because the tree sets dataformCoreVersion, the CLI itself installs the matching
# @dataform/core from the npm registry for the compile, so this check needs
# network access. Compilation is not expected to modify <tree_dir>; this script
# fails if it leaves npm artifacts behind, so a compiled tree is always safe to
# publish unchanged.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <tree_dir>" >&2
  exit 2
fi

tree_dir="$1"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="${script_dir}/../dataform-cli/node_modules/.bin/dataform"

if [[ ! -f "${tree_dir}/workflow_settings.yaml" ]]; then
  echo "error: ${tree_dir}/workflow_settings.yaml not found" >&2
  exit 2
fi
if [[ ! -x "${cli}" ]]; then
  echo "error: pinned Dataform CLI not installed at ${cli}" >&2
  echo "run: node scripts/hardened-npm-install.mjs --project workers/analytics-dataflow/dataform-cli" >&2
  exit 2
fi

output="$(mktemp)"
trap 'rm -f "${output}"' EXIT

"${cli}" compile "${tree_dir}" --json > "${output}"

for artifact in node_modules package.json package-lock.json; do
  if [[ -e "${tree_dir}/${artifact}" ]]; then
    echo "error: compile left ${artifact} in ${tree_dir}; the tree must stay publishable as generated" >&2
    exit 1
  fi
done

python3 - "${output}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    compiled = json.load(handle)

errors = compiled.get("graphErrors") or {}
messages = []
for key in ("compilationErrors", "validationErrors"):
    for item in errors.get(key) or []:
        messages.append(f"{key}: {item.get('fileName', '?')}: {item.get('message', item)}")
if messages or errors:
    print("Dataform compile reported graph errors:", file=sys.stderr)
    for message in messages or [json.dumps(errors)]:
        print(f"  {message}", file=sys.stderr)
    sys.exit(1)

tables = compiled.get("tables") or []
print(
    "Dataform compile OK: "
    f"{len(tables)} tables, "
    f"{len(compiled.get('assertions') or [])} assertions, "
    f"{len(compiled.get('operations') or [])} operations"
)
PY
