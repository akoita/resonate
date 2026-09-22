#!/usr/bin/env bash
#
# Run Gambit with the same effective Solidity remappings as Foundry.
#
# Usage: scripts/gambit-mutate.sh <gambit-config.json>
set -uo pipefail

CONFIG="${1:?usage: gambit-mutate.sh <gambit-config.json>}"
if ! CONFIG_DIR=$(cd -- "$(dirname -- "$CONFIG")" && pwd); then
  echo "ERROR: cannot access the Gambit config directory." >&2
  exit 2
fi
CONFIG_NAME=$(basename -- "$CONFIG")
cd "$CONFIG_DIR" || exit 2
if ! REMAPPINGS=$(mktemp "$CONFIG_DIR/.gambit-remappings.XXXXXX"); then
  echo "ERROR: could not create a temporary file for Foundry remappings." >&2
  exit 2
fi
if ! DERIVED_CONFIG=$(mktemp "$CONFIG_DIR/.gambit-derived.XXXXXX.json"); then
  rm -f "$REMAPPINGS"
  echo "ERROR: could not create a temporary Gambit config." >&2
  exit 2
fi
cleanup() { rm -f "$REMAPPINGS" "$DERIVED_CONFIG"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

if ! forge remappings > "$REMAPPINGS"; then
  echo "ERROR: forge remappings failed; cannot prepare the Gambit config." >&2
  exit 2
fi

if ! python3 - "$CONFIG_NAME" "$REMAPPINGS" "$DERIVED_CONFIG" <<'PY'
import json
from pathlib import Path
import sys

config_path, remappings_path, output_path = map(Path, sys.argv[1:])

try:
    config = json.loads(config_path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"ERROR: cannot read Gambit config {config_path}: {error}")

if "solc_remappings" in config:
    raise SystemExit(
        f"ERROR: {config_path} declares solc_remappings; use forge remappings as the single source of truth."
    )

remappings = [
    line.strip()
    for line in remappings_path.read_text(encoding="utf-8").splitlines()
    if line.strip() and "=" in line and Path(line.split("=", 1)[1].strip()).exists()
]
if not remappings:
    raise SystemExit("ERROR: forge remappings returned no effective remappings.")
config["solc_remappings"] = remappings
Path(output_path).write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
PY
then
  exit 2
fi

gambit mutate --json "$DERIVED_CONFIG"
