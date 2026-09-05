from __future__ import annotations

import json
import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "submit-cloud-build.sh"
DIGEST = "sha256:" + "b" * 64


class SubmitCloudBuildTests(unittest.TestCase):
    def _run(self, registry_digest: str) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        context = root / "context"
        context.mkdir()
        (context / "Dockerfile").write_text("FROM scratch\n", encoding="utf-8")
        bin_dir = root / "bin"
        bin_dir.mkdir()
        gcloud = bin_dir / "gcloud"
        gcloud.write_text(
            textwrap.dedent(
                f"""\
                #!/usr/bin/env bash
                set -euo pipefail
                if [[ " $* " == *" builds submit "* ]]; then
                  printf '%s\\n' '{{"id":"build-123","status":"SUCCESS"}}'
                elif [[ " $* " == *" artifacts docker images describe "* ]]; then
                  printf '%s\\n' '{registry_digest}'
                else
                  printf 'unexpected gcloud invocation: %s\\n' "$*" >&2
                  exit 1
                fi
                """
            ),
            encoding="utf-8",
        )
        gcloud.chmod(gcloud.stat().st_mode | stat.S_IXUSR)
        metadata = root / "evidence" / "build.json"
        github_output = root / "github-output"
        result = subprocess.run(
            [
                "bash",
                str(SCRIPT),
                "--project",
                "project-id",
                "--context",
                str(context),
                "--dockerfile",
                "Dockerfile",
                "--image",
                "europe-docker.pkg.dev/project-id/repository/backend:abc123",
                "--metadata-output",
                str(metadata),
            ],
            check=False,
            capture_output=True,
            text=True,
            env={
                **os.environ,
                "PATH": f"{bin_dir}:{os.environ['PATH']}",
                "GITHUB_OUTPUT": str(github_output),
                "GITHUB_SHA": "a" * 40,
            },
        )
        return result, metadata, github_output

    def test_writes_separate_digest_bound_metadata_and_outputs(self) -> None:
        result, metadata, github_output = self._run(DIGEST)
        self.assertEqual(result.returncode, 0, result.stderr)
        evidence = json.loads(metadata.read_text(encoding="utf-8"))
        self.assertEqual(evidence["cloud_build_id"], "build-123")
        self.assertEqual(evidence["digest"], DIGEST)
        self.assertEqual(
            evidence["immutable_ref"],
            f"europe-docker.pkg.dev/project-id/repository/backend@{DIGEST}",
        )
        self.assertEqual(evidence["source_sha"], "a" * 40)
        outputs = github_output.read_text(encoding="utf-8")
        self.assertIn(f"image_digest={DIGEST}\n", outputs)
        self.assertIn(f"image_ref={evidence['immutable_ref']}\n", outputs)

    def test_rejects_malformed_registry_digest(self) -> None:
        result, metadata, _ = self._run("sha256:not-valid")
        self.assertEqual(result.returncode, 1)
        self.assertIn("did not return one valid sha256 digest", result.stderr)
        self.assertFalse(metadata.exists())


if __name__ == "__main__":
    unittest.main()
