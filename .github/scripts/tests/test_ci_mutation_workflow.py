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
LAUNCHER = ROOT / "contracts/scripts/gambit-mutate.sh"
GAMBIT_CONFIGS = sorted((ROOT / "contracts").glob("gambit*.json"))


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
            result, source, scored, derived_config = self._run_scorer(shard_index, 2)

            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertEqual(source.read_text(encoding="utf-8"), "original\n")
            self.assertEqual(
                json.loads(derived_config.read_text(encoding="utf-8"))["solc_remappings"],
                ["example/=/tmp/", "nested/=/var/tmp/"],
            )
            self.assertIn(f"Scoring shard {shard_index + 1}/2 (3 mutants", result.stdout)
            self.assertIn("3 scored (of 3 in shard, 6 total)", result.stdout)
            selected.append(scored)

        self.assertEqual(selected[0], ["mutant-0", "mutant-2", "mutant-4"])
        self.assertEqual(selected[1], ["mutant-1", "mutant-3", "mutant-5"])
        self.assertEqual(sorted(selected[0] + selected[1]), [f"mutant-{i}" for i in range(6)])

    def test_checked_in_configs_do_not_duplicate_effective_remappings(self):
        self.assertEqual(len(GAMBIT_CONFIGS), 5)
        for config_path in GAMBIT_CONFIGS:
            with self.subTest(config=config_path.name):
                config = json.loads(config_path.read_text(encoding="utf-8"))
                self.assertNotIn("solc_remappings", config)

    def test_launcher_rejects_config_owned_remappings(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        forge = bin_dir / "forge"
        forge.write_text("#!/usr/bin/env bash\nprintf '%s\\n' 'example/=/tmp/'\n", encoding="utf-8")
        self._make_executable(forge)
        config = root / "gambit.json"
        config.write_text(json.dumps({"solc_remappings": ["stale/=mapping/"]}), encoding="utf-8")
        env = os.environ.copy()
        env["PATH"] = f"{bin_dir}{os.pathsep}{env['PATH']}"

        result = subprocess.run(
            [str(LAUNCHER), str(config)],
            cwd=ROOT / "contracts",
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("declares solc_remappings", result.stderr)

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
        derived_config = root / "derived-gambit.json"
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
import os
import sys

config = json.loads(Path(sys.argv[-1]).read_text(encoding="utf-8"))
Path(os.environ["FAKE_GAMBIT_CONFIG"]).write_text(
    json.dumps(config), encoding="utf-8"
)
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
if [ "${1:-}" = "remappings" ]; then
  printf '%s\n' 'example/=/tmp/' 'nested/=/var/tmp/' 'missing/=does-not-exist/'
  exit 0
fi
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
                "FAKE_GAMBIT_CONFIG": str(derived_config),
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
        return result, source, scored, derived_config

    @staticmethod
    def _make_executable(path: Path):
        path.chmod(path.stat().st_mode | stat.S_IXUSR)


if __name__ == "__main__":
    unittest.main()
