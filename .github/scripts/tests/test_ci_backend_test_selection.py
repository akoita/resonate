"""Regression checks for Jest's changed-source test selection."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / ".github/scripts/select-backend-tests.sh"
FULL_SUITE = "__FULL_SUITE__"
OVERRIDES = ("BACKEND_RUN_ALL", "REPO_SHARED", "BACKEND_SHARED")


class BackendTestSelectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        self.git("init", "--quiet")
        self.git("config", "user.name", "CI selection test")
        self.git("config", "user.email", "ci-selection@example.invalid")
        self.write("README.md")
        self.write("backend/src/modules/analytics/analytics.service.ts")
        self.write("backend/src/tests/analytics.service.spec.ts")
        self.commit()

    def git(self, *args: str) -> str:
        return subprocess.check_output(
            ["git", *args], cwd=self.repo, text=True, stderr=subprocess.PIPE
        ).strip()

    def write(self, name: str, content: str = "fixture\n") -> None:
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def commit(self) -> None:
        self.git("add", "--all")
        self.git(
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        )
        self.base = self.git("rev-parse", "HEAD")

    def select(self, updates: dict[str, str | None], **env_overrides: str) -> str:
        base = self.base
        for name, content in updates.items():
            path = self.repo / name
            if content is None:
                path.unlink()
            else:
                self.write(name, content)
        self.commit()
        return self.run_selector(env_overrides.pop("BASE_SHA", base), **env_overrides)

    def run_selector(self, base_sha: str, **env_overrides: str) -> str:
        (self.repo / "backend").mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env.update({name: "false" for name in OVERRIDES})
        env["BASE_SHA"] = base_sha
        env.update(env_overrides)
        result = subprocess.run(
            ["bash", str(SCRIPT), "unit"],
            cwd=self.repo / "backend",
            env=env,
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_analytics_service_and_added_source_are_returned_relative_to_backend(self) -> None:
        selected = self.select(
            {
                "backend/src/modules/analytics/analytics.service.ts": "export const changed = true;\n",
                "backend/src/modules/analytics/new-report.service.ts": "export const added = true;\n",
            }
        )
        self.assertEqual(
            selected,
            "src/modules/analytics/analytics.service.ts\n"
            "src/modules/analytics/new-report.service.ts",
        )

    def test_direct_spec_edits_select_the_spec_itself(self) -> None:
        selected = self.select(
            {
                "backend/src/tests/analytics.service.spec.ts": "describe('changed', () => {});\n",
                "backend/src/modules/analytics/internal/rollup.spec.ts": "describe('added', () => {});\n",
            }
        )
        self.assertEqual(
            selected,
            "src/modules/analytics/internal/rollup.spec.ts\n"
            "src/tests/analytics.service.spec.ts",
        )

    def test_every_tracked_backend_spec_path_is_selectable(self) -> None:
        tracked = subprocess.check_output(
            ["git", "ls-files", "-z", "backend/src"],
            cwd=REPO_ROOT,
        ).split(b"\0")
        spec_paths = sorted(
            os.fsdecode(path)
            for path in tracked
            if path and path.endswith(b".spec.ts")
        )
        self.assertTrue(spec_paths, "expected tracked backend spec files")

        for path in spec_paths:
            self.write(path, "describe('baseline', () => {});\n")
        self.commit()
        base = self.base

        for path in spec_paths:
            self.write(path, "describe('changed', () => {});\n")
        self.commit()

        selected = self.run_selector(base)
        expected = "\n".join(sorted(path.removeprefix("backend/") for path in spec_paths))
        self.assertEqual(selected, expected)

    def test_configuration_shared_runtime_and_prisma_paths_use_full_suite(self) -> None:
        full_suite_paths = [
            "backend/prisma/schema.prisma",
            "backend/package.json",
            "backend/package-lock.json",
            "backend/jest.config.js",
            "backend/jest.integration.config.js",
            "backend/src/main.ts",
            "backend/src/db/prisma.ts",
            "backend/src/modules/shared/shared.module.ts",
            "backend/src/tests/globalSetup.js",
            "backend/src/tests/globalTeardown.js",
            "backend/src/tests/testcontainers.setup.ts",
        ]
        for path in full_suite_paths:
            with self.subTest(path=path):
                self.assertEqual(self.select({path: "changed\n"}), FULL_SUITE)

    def test_unknown_backend_paths_and_deletions_use_full_suite(self) -> None:
        self.assertEqual(
            self.select({"backend/config/custom-build.conf": "changed\n"}), FULL_SUITE
        )
        self.assertEqual(
            self.select(
                {"backend/src/modules/analytics/analytics.service.ts": None}
            ),
            FULL_SUITE,
        )

    def test_invalid_base_and_diff_without_merge_base_use_full_suite(self) -> None:
        self.assertEqual(
            self.select(
                {"backend/src/modules/analytics/analytics.service.ts": "changed\n"},
                BASE_SHA="not-a-revision",
            ),
            FULL_SUITE,
        )

        unrelated_base = self.base
        self.git("checkout", "--orphan", "unrelated")
        self.git("rm", "--quiet", "-rf", ".")
        self.write("other.txt")
        self.commit()
        self.assertEqual(self.run_selector(unrelated_base), FULL_SUITE)

    def test_no_changed_backend_source_uses_full_suite(self) -> None:
        self.assertEqual(self.select({"README.md": "documentation change\n"}), FULL_SUITE)

    def test_full_suite_overrides_are_retained(self) -> None:
        for name in OVERRIDES:
            with self.subTest(override=name):
                self.assertEqual(
                    self.select(
                        {
                            "backend/src/modules/analytics/analytics.service.ts": f"changed {name}\n"
                        },
                        **{name: "true"},
                    ),
                    FULL_SUITE,
                )


if __name__ == "__main__":
    unittest.main()
