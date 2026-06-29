#!/usr/bin/env bash
#
# Storage-layout gate for upgradeable (UUPS) contracts.
#
# Snapshots the storage layout of each listed contract and verifies it against a
# committed baseline, so a layout-shifting change to a UUPS contract fails CI before
# it can corrupt an on-chain proxy's storage. After an intentional, upgrade-safe
# change (e.g. appending a variable and shrinking `__gap`), run with `--update`,
# review the diff, and commit the regenerated baseline.
#
# Usage:  scripts/check-storage-layout.sh [--update]
#
# Requires a `solc`-capable Foundry build (run from contracts/).
set -uo pipefail

MODE="${1:-check}"
CONTRACTS=(ContentProtection)
DIR="storage-layout"
mkdir -p "$DIR"

# Drop astId/contract (which change on unrelated edits) and keep only the
# layout-relevant fields + the type definitions, sorted for a stable diff.
normalize() {
  python3 -c "
import json, sys
d = json.load(sys.stdin)
print(json.dumps({
    'storage': [{k: s[k] for k in ('label', 'slot', 'offset', 'type')} for s in d.get('storage', [])],
    'types': d.get('types', {}),
}, indent=2, sort_keys=True))
"
}

fail=0
for c in "${CONTRACTS[@]}"; do
  cur=$(forge inspect "$c" storageLayout --json 2>/dev/null | normalize)
  base="$DIR/$c.json"

  if [ "$MODE" = "--update" ]; then
    printf '%s\n' "$cur" > "$base"
    echo "updated $base"
  elif [ ! -f "$base" ]; then
    echo "::error::missing storage-layout baseline $base — run scripts/check-storage-layout.sh --update"
    fail=1
  elif ! diff -u "$base" <(printf '%s\n' "$cur") >/dev/null; then
    echo "::error::Storage layout changed for ${c}. If this is an intentional, upgrade-safe change, run 'scripts/check-storage-layout.sh --update' and commit ${base}."
    diff -u "$base" <(printf '%s\n' "$cur") || true
    fail=1
  else
    echo "OK: ${c} storage layout unchanged"
  fi
done

exit "$fail"
