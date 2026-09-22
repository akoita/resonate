"""Regression checks for Vitest change selection."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "select-web-tests.sh"


def git(cwd: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()


class WebTestSelectionTests(unittest.TestCase):
    def select(self, updates: dict[str, str | None], **env: str) -> str:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            git(root, "init", "-q")
            git(root, "config", "user.email", "ci@example.test")
            git(root, "config", "user.name", "CI")
            source = root / "web/src/lib/catalog.ts"
            source.parent.mkdir(parents=True)
            source.write_text("export const value = 1;\n")
            git(root, "add", ".")
            git(root, "commit", "-qm", "base")
            base = git(root, "rev-parse", "HEAD")

            for name, content in updates.items():
                path = root / name
                if content is None:
                    path.unlink()
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(content)
            git(root, "add", "-A")
            git(root, "commit", "-qm", "change")
            process = subprocess.run(
                ["bash", str(SCRIPT)],
                cwd=root / "web",
                env={**os.environ, "BASE_SHA": base, **env},
                text=True,
                capture_output=True,
                check=True,
            )
            return process.stdout.strip()

    def test_source_and_spec_are_related_inputs(self) -> None:
        self.assertEqual(
            self.select({
                "web/src/lib/catalog.ts": "export const value = 2;\n",
                "web/src/lib/catalog.test.ts": "export const test = 1;\n",
            }),
            "src/lib/catalog.test.ts\nsrc/lib/catalog.ts",
        )

    def test_deleted_source_uses_full_suite(self) -> None:
        self.assertEqual(
            self.select({"web/src/lib/catalog.ts": None}), "__FULL_SUITE__"
        )

    def test_config_uses_full_suite(self) -> None:
        self.assertEqual(
            self.select({"web/vitest.config.ts": "changed\n"}), "__FULL_SUITE__"
        )

    def test_shared_override_uses_full_suite(self) -> None:
        self.assertEqual(
            self.select({"web/src/lib/catalog.ts": "changed\n"}, REPO_SHARED="true"),
            "__FULL_SUITE__",
        )

    def test_invalid_base_uses_full_suite(self) -> None:
        self.assertEqual(
            self.select({"web/src/lib/catalog.ts": "changed\n"}, BASE_SHA="missing"),
            "__FULL_SUITE__",
        )


if __name__ == "__main__":
    unittest.main()
