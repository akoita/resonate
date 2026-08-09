#!/usr/bin/env bash
#
# Storage-layout gate for upgradeable (UUPS) contracts.
#
# Snapshots the storage layout of each listed contract and verifies it against a
# committed baseline, so a layout-shifting change to a UUPS contract fails CI before
# it can corrupt an on-chain proxy's storage. Linear contracts are inspected
# directly. ERC-7201 contracts use an inspection-only harness that lays the exact
# namespace struct out from relative slot zero. After an intentional, upgrade-safe
# change (append a variable and shrink `__gap`, or append a namespace member), run
# with `--update`, review the diff, and commit the regenerated baseline.
#
# Usage:  scripts/check-storage-layout.sh [--update]
#
# Requires a `solc`-capable Foundry build (run from contracts/).
set -euo pipefail

MODE="${1:-check}"
CONTRACTS=(ContentProtection ShowCampaignEscrow RevenueEscrow StemMarketplaceV2)
DIR="storage-layout"
mkdir -p "$DIR"

# Produce an astId-free, environment-independent layout snapshot. forge's raw type
# identifiers embed compiler astIds (e.g. `t_struct(Attestation)1234_storage`) that
# differ between machines/compilations, so instead of snapshotting those we resolve
# each storage slot to its human type label + encoding + byte size — the
# layout-relevant facts, stable across solc 0.8.x builds.
normalize() {
  python3 -c "
import json, sys
d = json.load(sys.stdin)
types = d.get('types', {})
def tinfo(tk):
    t = types.get(tk, {})
    return {'type': t.get('label'), 'encoding': t.get('encoding'), 'bytes': t.get('numberOfBytes')}
out = [
    {'label': s['label'], 'slot': s['slot'], 'offset': s['offset'], **tinfo(s['type'])}
    for s in d.get('storage', [])
]
print(json.dumps(out, indent=2, sort_keys=True))
"
}

# Solidity's storageLayout output only describes conventional state variables;
# an ERC-7201 struct reached through an assembly storage pointer is intentionally
# absent. Inspect a harness containing the exact imported namespace type and retain
# its complete recursive type shape, including mapping value structs.
normalize_namespace() {
  NAMESPACE="erc7201:resonate.storage.StemMarketplaceV2" \
  ROOT="0xf3c94fb6abe0389909903f3f4216f8fe092cd4b74654cae83abd3da828d90500" \
  python3 -c "
import json, os, sys
d = json.load(sys.stdin)
types = d.get('types', {})
storage = d.get('storage', [])
if len(storage) != 1 or storage[0].get('label') != 'layout':
    raise SystemExit('StemMarketplaceStorageLayout must expose exactly one layout variable')

def tinfo(tk):
    t = types.get(tk, {})
    out = {
        'type': t.get('label'),
        'encoding': t.get('encoding'),
        'bytes': t.get('numberOfBytes'),
    }
    if 'key' in t:
        out['key'] = tinfo(t['key'])
    if 'value' in t:
        out['value'] = tinfo(t['value'])
    if 'members' in t:
        out['members'] = [
            {
                'label': m['label'],
                'slot': m['slot'],
                'offset': m['offset'],
                **tinfo(m['type']),
            }
            for m in t['members']
        ]
    return out

layout = storage[0]
print(json.dumps({
    'namespace': os.environ['NAMESPACE'],
    'root': os.environ['ROOT'],
    'layout': tinfo(layout['type']),
}, indent=2, sort_keys=True))
"
}

fail=0
for c in "${CONTRACTS[@]}"; do
  # `forge test` can overwrite a contract artifact without storage-layout output.
  # Disable the cache so this gate always asks solc for the requested layout instead
  # of depending on whichever artifact shape the preceding command happened to emit.
  if [ "$c" = "StemMarketplaceV2" ]; then
    cur=$(forge inspect --no-cache StemMarketplaceStorageLayout storageLayout --json 2>/dev/null | normalize_namespace)
  else
    cur=$(forge inspect --no-cache "$c" storageLayout --json 2>/dev/null | normalize)
  fi
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
