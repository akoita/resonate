"""Regression coverage for the bounded Gambit mutation workflow."""

from pathlib import Path
import json
import os
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github/workflows/mutation.yml"
SCORER = ROOT / "contracts/scripts/mutation-score.sh"


class MutationWorkflowTests(unittest.TestCase):
    def test_large_campaigns_are_split_without_sharding_smaller_targets(self):
        text = WORKFLOW.read_text(encoding="utf-8")

        self.assertEqual(text.count("contract: ShowCampaignEscrow,"), 2)
        self.assertEqual(text.count("contract: ContentProtection,"), 2)
        self.assertEqual(text.count("contract: StemNFT,"), 1)
        self.assertEqual(text.count("contract: StemMarketplaceV2,"), 1)
        self.assertEqual(text.count("contract: RevenueEscrow,"), 1)
        self.assertIn("MUTANT_SHARD_INDEX: ${{ matrix.shard }}", text)
        self.assertIn("MUTANT_SHARD_COUNT: ${{ matrix.shards }}", text)

    def test_two_shards_are_disjoint_exhaustive_and_restore_source(self):
        selected = []
        for shard_index in (0, 1):
            result, source, scored = self._run_scorer(shard_index, 2)

            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertEqual(source.read_text(encoding="utf-8"), "original\n")
            self.assertIn(f"Scoring shard {shard_index + 1}/2 (3 mutants", result.stdout)
            self.assertIn("3 scored (of 3 in shard, 6 total)", result.stdout)
            selected.append(scored)

        self.assertEqual(selected[0], ["mutant-0", "mutant-2", "mutant-4"])
        self.assertEqual(selected[1], ["mutant-1", "mutant-3", "mutant-5"])
        self.assertEqual(sorted(selected[0] + selected[1]), [f"mutant-{i}" for i in range(6)])

    def test_invalid_shard_coordinates_fail_closed(self):
        env = os.environ.copy()
        env.update({"MUTANT_SHARD_INDEX": "2", "MUTANT_SHARD_COUNT": "2"})
        result = subprocess.run(
            [str(SCORER), "unused.json"],
            cwd=ROOT / "contracts",
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("must be between 0 and MUTANT_SHARD_COUNT - 1", result.stderr)

    def _run_scorer(self, shard_index: int, shard_count: int):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        source = root / "Source.sol"
        source.write_text("original\n", encoding="utf-8")
        score_log = root / "scored.log"
        config = root / "gambit.json"
        config.write_text(
            json.dumps({"filename": str(source), "outdir": str(root / "mutants")}),
            encoding="utf-8",
        )

        gambit = bin_dir / "gambit"
        gambit.write_text(
            """#!/usr/bin/env python3
from pathlib import Path
import json
import sys

config = json.loads(Path(sys.argv[-1]).read_text(encoding="utf-8"))
outdir = Path(config["outdir"])
outdir.mkdir(parents=True, exist_ok=True)
results = []
for index in range(6):
    name = f"mutant-{index}.sol"
    (outdir / name).write_text(f"mutant-{index}\\n", encoding="utf-8")
    results.append({"id": str(index), "name": name})
(outdir / "gambit_results.json").write_text(json.dumps(results), encoding="utf-8")
""",
            encoding="utf-8",
        )
        self._make_executable(gambit)

        forge = bin_dir / "forge"
        forge.write_text(
            """#!/usr/bin/env bash
set -uo pipefail
value=$(tr -d '\\n' < "$FAKE_MUTATION_SOURCE")
if [ "$value" = "original" ]; then
  exit 0
fi
printf '%s\\n' "$value" >> "$FAKE_MUTATION_LOG"
# Leave some mutants alive so the real scorer exercises its exit-1 report path.
case "$value" in
  mutant-0|mutant-3|mutant-4) exit 0 ;;
  *) exit 1 ;;
esac
""",
            encoding="utf-8",
        )
        self._make_executable(forge)

        env = os.environ.copy()
        env.update(
            {
                "PATH": f"{bin_dir}{os.pathsep}{env['PATH']}",
                "FAKE_MUTATION_SOURCE": str(source),
                "FAKE_MUTATION_LOG": str(score_log),
                "MUTANT_SHARD_INDEX": str(shard_index),
                "MUTANT_SHARD_COUNT": str(shard_count),
            }
        )
        result = subprocess.run(
            [str(SCORER), str(config), "MutationHarness"],
            cwd=ROOT / "contracts",
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )
        scored = score_log.read_text(encoding="utf-8").splitlines()
        return result, source, scored

    @staticmethod
    def _make_executable(path: Path):
        path.chmod(path.stat().st_mode | stat.S_IXUSR)


if __name__ == "__main__":
    unittest.main()
