"""Exercise CI selection with real Git histories, including fail-closed cases."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "classify-ci-changes.sh"


class ChangeDetectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "--quiet")
        self.git("config", "user.name", "CI selection test")
        self.git("config", "user.email", "ci-selection@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.write("README.md")
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repo, text=True,
                                       stderr=subprocess.PIPE)

    def write(self, name, content="fixture\n"):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def commit(self):
        self.git("add", "--all")
        self.git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture")

    def detect(self, **overrides):
        output = self.root / "outputs"
        output.write_text("")
        env = {**os.environ, "EVENT_NAME": "pull_request", "REF_NAME": "1/merge",
               "HEAD_REF": "fix/example", "BASE_SHA": self.base,
               "RELEASE_VALIDATION": "false", "GITHUB_OUTPUT": str(output),
               "GITHUB_STEP_SUMMARY": str(self.root / "summary"), **overrides}
        result = subprocess.run(["bash", str(SCRIPT)], cwd=self.repo, env=env,
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        values = dict(line.split("=", 1) for line in output.read_text().splitlines())
        self.assertTrue(values)
        self.assertTrue(all(value in {"true", "false"} for value in values.values()))
        return {key: value == "true" for key, value in values.items()}

    def test_agent_config_pr_skips_application_suites(self):
        # Reproduce #1728, including the deleted settings hook which caused
        # the original full application/contract/desktop fan-out.
        self.write(".claude/settings.json", "{}\n")
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()
        (self.repo / ".claude/settings.json").unlink()
        for path in ["AGENTS.md", "docs/engineering/agent-skills.md",
                     ".agents/skills/start-issue/SKILL.md",
                     ".agents/skills/finish-issue/SKILL.md",
                     ".agents/skills/auditing-resonate-security/SKILL.md"]:
            self.write(path)
        self.commit()
        flags = self.detect()
        self.assertEqual({key for key, enabled in flags.items() if enabled}, {"docs_only"})

    def test_scoped_docs_and_runtime_metadata(self):
        for path in ["backend/AGENTS.md", "backend/TESTING.md", "contracts/CLAUDE.md",
                     "web/AGENTS.md", "web/README.md", "desktop/GEMINI.md",
                     ".claude/skills", ".gemini/commands/finish-issue.toml",
                     ".github/CODEOWNERS"]:
            with self.subTest(path=path):
                self.base = self.git("rev-parse", "HEAD").strip()
                self.write(path)
                self.commit()
                self.assertTrue(self.detect()["docs_only"])

    def test_runtime_and_shared_changes_remain_selected(self):
        cases = {
            "backend/src/modules/auth/example.ts": {"backend", "backend_identity"},
            "backend/src/modules/ingestion/example.ts": {"backend", "backend_ingestion"},
            "backend/src/modules/catalog/example.ts": {"backend", "backend_catalog"},
            "backend/src/modules/generation/prompt.md": {"backend", "backend_generation"},
            "backend/src/modules/mcp/example.ts": {"backend", "backend_marketplace", "backend_generation"},
            "backend/src/modules/payments/example.ts": {"backend", "backend_marketplace"},
            "backend/prisma/schema.prisma": {"backend", "backend_shared"},
            "backend/package-lock.json": {"backend", "backend_shared"},
            "web/src/lib/help/content.ts": {"web"},
            "web/public/help/screenshot.png": {"web"},
            "contracts/src/Example.sol": {"contracts"},
            "desktop/main.cjs": {"desktop"},
            "workers/demucs/main.py": {"demucs"},
            "workers/stable-audio/main.py": {"stable_audio"},
            "workers/analytics-dataflow/transform.py": {"analytics_dataflow"},
            ".agents/skills/example/scripts/run.sh": {"shared", "shared_image"},
            ".github/scripts/classify-ci-changes.sh": {"shared", "shared_image"},
            ".github/workflows/ci.yml": {"shared", "shared_image"},
            ".github/workflows/security.yml": {"shared"},
            ".github/actions/setup-npm-hardened/action.yml": {"shared", "shared_image"},
            "scripts/hardened-npm-install.mjs": {"shared", "shared_image"},
            "package.json": {"shared", "shared_image"},
            "unknown.config": {"shared", "shared_image"},
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                self.base = self.git("rev-parse", "HEAD").strip()
                self.write(path)
                self.commit()
                flags = self.detect()
                self.assertEqual({key for key, enabled in flags.items() if enabled}, expected)

    def test_mixed_docs_and_runtime_still_selects_runtime(self):
        self.write("backend/AGENTS.md")
        self.write("web/src/app/page.tsx")
        self.commit()
        flags = self.detect()
        self.assertTrue(flags["web"])
        self.assertFalse(flags["docs_only"])

    def test_rename_out_of_runtime_directory_preserves_source_selection(self):
        self.write("backend/src/modules/auth/example.ts")
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()
        (self.repo / "docs").mkdir()
        self.git("mv", "backend/src/modules/auth/example.ts", "docs/retired.md")
        self.commit()
        self.assertTrue(self.detect()["backend_identity"])

    def test_unusual_filename_is_not_split(self):
        self.write("backend/src/modules/auth/line\nbreak.ts")
        self.commit()
        flags = self.detect()
        self.assertTrue(flags["backend_identity"])
        self.assertFalse(flags["shared"])

    def test_empty_diff_runs_full_suite(self):
        self.assertTrue(self.detect()["run_all"])

    def test_missing_invalid_and_unavailable_base_run_full_suite(self):
        for base in ["", "0" * 40, "f" * 40, "not-a-revision"]:
            with self.subTest(base=base):
                self.assertTrue(self.detect(BASE_SHA=base)["run_all"])

    def test_existing_base_without_merge_ancestor_runs_full_suite(self):
        self.git("checkout", "--orphan", "unrelated")
        self.git("rm", "-rf", ".")
        self.write("other.md")
        self.commit()
        self.assertTrue(self.detect()["run_all"])

    def test_queue_release_and_manual_modes(self):
        self.write("docs/change.md")
        self.commit()
        cases = [
            {"EVENT_NAME": "merge_group"},
            {"HEAD_REF": "mergify/merge-queue/main/batch"},
            {"EVENT_NAME": "push", "REF_NAME": "mergify/merge-queue/main/batch"},
            {"EVENT_NAME": "workflow_dispatch", "BASE_SHA": ""},
            {"RELEASE_VALIDATION": "true"},
            {"RELEASE_VALIDATION": "true", "EVENT_NAME": "push", "REF_NAME": "main"},
        ]
        for context in cases:
            with self.subTest(context=context):
                flags = self.detect(**context)
                self.assertTrue(flags["run_all"])
                self.assertFalse(flags["docs_only"])
                self.assertFalse(flags["main_post_merge"])

    def test_ordinary_main_push_keeps_receipt_mode(self):
        self.write("web/src/app/page.tsx")
        self.commit()
        flags = self.detect(EVENT_NAME="push", REF_NAME="main")
        self.assertTrue(flags["main_post_merge"])
        self.assertTrue(flags["web"])

    def test_develop_push_still_validates_changed_packages(self):
        self.write("web/src/app/page.tsx")
        self.commit()
        flags = self.detect(EVENT_NAME="push", REF_NAME="develop")
        self.assertFalse(flags["main_post_merge"])
        self.assertTrue(flags["web"])


if __name__ == "__main__":
    unittest.main()
