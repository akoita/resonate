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
# Env:    MAX_MUTANTS=<n>   score at most n mutants (0 = all; default 0). Useful for a
#                           quick local smoke run.
#
# Requires `gambit` and a standalone `solc` on PATH — see contracts/README.md.
set -uo pipefail

CONFIG="${1:?usage: mutation-score.sh <gambit-config.json> [match-contract]}"
MATCH="${2:-}"
MAX="${MAX_MUTANTS:-0}"

OUTDIR=$(python3 -c "import json; print(json.load(open('$CONFIG'))['outdir'])")
ORIGINAL=$(python3 -c "import json; print(json.load(open('$CONFIG'))['filename'])")

echo "==> Generating mutants: $CONFIG ($ORIGINAL)"
rm -rf "$OUTDIR"
gambit mutate --json "$CONFIG" >/dev/null

RESULTS="$OUTDIR/gambit_results.json"
TOTAL=$(python3 -c "import json; print(len(json.load(open('$RESULTS'))))")
echo "==> $TOTAL mutants generated"

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
survivors=""
while IFS=$'\t' read -r id name; do
  n=$((n + 1))
  if [ "$MAX" -gt 0 ] && [ "$n" -gt "$MAX" ]; then break; fi
  cp "$OUTDIR/$name" "$ORIGINAL"
  if "${FORGE[@]}" >/dev/null 2>&1; then
    survived=$((survived + 1))
    survivors="$survivors $id"
  else
    killed=$((killed + 1))
  fi
done < <(python3 -c "import json;[print(m['id']+chr(9)+m['name']) for m in json.load(open('$RESULTS'))]")

restore
trap - EXIT

scored=$((killed + survived))
score=$(python3 -c "print(f'{$killed/$scored*100:.1f}' if $scored else '0.0')")
echo "==> Mutation score: $killed killed / $scored scored (of $TOTAL total) = ${score}%"
echo "==> Surviving mutant ids:${survivors:- none}"

# Non-zero exit when mutants survive so a scheduled CI run surfaces the gap.
[ "$survived" -gt 0 ] && exit 1 || exit 0
