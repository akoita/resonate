#!/usr/bin/env bash
#
# Gambit mutation kill-scoring for one contract.
#
# Generates mutants from a Gambit config, then runs the Foundry suite against each
# mutant: a mutant that leaves the suite GREEN is a *survivor* (a gap in test/spec
# strength) and a mutant that turns it RED is *killed*. Reports the kill score and
# the surviving mutant ids — survivors become follow-up tests or CVL spec rules.
#
# Usage:  scripts/mutation-score.sh <gambit-config.json> [forge --match-contract pattern]
# Env:    MAX_MUTANTS=<n>        score at most n mutants in this shard (0 = all;
#                                default 0). Useful for a quick local smoke run.
#         MUTANT_SHARD_INDEX=<n> zero-based shard index (default 0).
#         MUTANT_SHARD_COUNT=<n> total number of interleaved shards (default 1).
#
# Requires `gambit` and a standalone `solc` on PATH — see contracts/README.md.
set -uo pipefail

CONFIG="${1:?usage: mutation-score.sh <gambit-config.json> [match-contract]}"
MATCH="${2:-}"
MAX="${MAX_MUTANTS:-0}"
SHARD_INDEX="${MUTANT_SHARD_INDEX:-0}"
SHARD_COUNT="${MUTANT_SHARD_COUNT:-1}"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

if [[ ! "$MAX" =~ ^[0-9]+$ ]]; then
  echo "ERROR: MAX_MUTANTS must be a non-negative integer." >&2
  exit 2
fi
if [[ ! "$SHARD_INDEX" =~ ^[0-9]+$ ]] || [[ ! "$SHARD_COUNT" =~ ^[1-9][0-9]*$ ]] \
  || [ "$SHARD_INDEX" -ge "$SHARD_COUNT" ]; then
  echo "ERROR: MUTANT_SHARD_INDEX must be between 0 and MUTANT_SHARD_COUNT - 1." >&2
  exit 2
fi

OUTDIR=$(python3 -c "import json; print(json.load(open('$CONFIG'))['outdir'])")
ORIGINAL=$(python3 -c "import json; print(json.load(open('$CONFIG'))['filename'])")

echo "==> Generating mutants: $CONFIG ($ORIGINAL)"
rm -rf "$OUTDIR"
if ! "$SCRIPT_DIR/gambit-mutate.sh" "$CONFIG" >/dev/null; then
  echo "ERROR: Gambit failed to generate mutants; check compiler output and remappings." >&2
  exit 2
fi

RESULTS="$OUTDIR/gambit_results.json"
if [ ! -f "$RESULTS" ]; then
  echo "ERROR: Gambit did not write $RESULTS." >&2
  exit 2
fi
if ! TOTAL=$(python3 -c "import json; print(len(json.load(open('$RESULTS'))))"); then
  echo "ERROR: Gambit results are not valid JSON." >&2
  exit 2
fi
echo "==> $TOTAL mutants generated"
if [[ ! "$TOTAL" =~ ^[0-9]+$ ]] || [ "$TOTAL" -eq 0 ]; then
  echo "ERROR: Gambit generated zero mutants; check compiler output and remappings." >&2
  exit 2
fi

if [ "$TOTAL" -le "$SHARD_INDEX" ]; then
  echo "ERROR: shard $((SHARD_INDEX + 1))/$SHARD_COUNT selects no mutants from $TOTAL generated." >&2
  exit 2
fi
SHARD_TOTAL=$(((TOTAL - SHARD_INDEX + SHARD_COUNT - 1) / SHARD_COUNT))
echo "==> Scoring shard $((SHARD_INDEX + 1))/$SHARD_COUNT ($SHARD_TOTAL mutants before MAX_MUTANTS)"

# Always restore the pristine source, even on interrupt/timeout/error.
cp "$ORIGINAL" "$ORIGINAL.mutorig"
restore() { cp "$ORIGINAL.mutorig" "$ORIGINAL" 2>/dev/null; rm -f "$ORIGINAL.mutorig"; }
trap restore EXIT
trap 'restore; exit 130' INT TERM

FORGE=(forge test --no-match-path "test/formal/*")
[ -n "$MATCH" ] && FORGE+=(--match-contract "$MATCH")

echo "==> Baseline test run (must be green before scoring)"
if ! "${FORGE[@]}" >/dev/null 2>&1; then
  echo "ERROR: baseline suite is not green; aborting." >&2
  exit 2
fi

killed=0
survived=0
n=0
position=0
survivors=""
while IFS=$'\t' read -r id name; do
  if [ $((position % SHARD_COUNT)) -ne "$SHARD_INDEX" ]; then
    position=$((position + 1))
    continue
  fi
  position=$((position + 1))
  n=$((n + 1))
  if [ "$MAX" -gt 0 ] && [ "$n" -gt "$MAX" ]; then break; fi
  cp "$OUTDIR/$name" "$ORIGINAL"
  if "${FORGE[@]}" >/dev/null 2>&1; then
    survived=$((survived + 1))
    survivors="$survivors $id"
  else
    killed=$((killed + 1))
  fi
  if [ $((n % 25)) -eq 0 ]; then
    echo "==> Scored $n/$SHARD_TOTAL shard mutants"
  fi
done < <(python3 -c "import json;[print(m['id']+chr(9)+m['name']) for m in json.load(open('$RESULTS'))]")

restore
trap - EXIT

scored=$((killed + survived))
score=$(python3 -c "print(f'{$killed/$scored*100:.1f}' if $scored else '0.0')")
echo "==> Mutation score: $killed killed / $scored scored (of $SHARD_TOTAL in shard, $TOTAL total) = ${score}%"
echo "==> Surviving mutant ids:${survivors:- none}"

# Non-zero exit when mutants survive so a scheduled CI run surfaces the gap.
[ "$survived" -gt 0 ] && exit 1 || exit 0
