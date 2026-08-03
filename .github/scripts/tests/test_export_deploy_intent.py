from __future__ import annotations

import os
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
from image_evidence import SERVICES, build_manifest, write_manifest  # noqa: E402


REVISION = "a" * 40


class ExportDeployIntentTests(unittest.TestCase):
    def test_exports_digest_fields_and_stable_audio(self) -> None:
        tags = {service: f"registry.example/resonate/{service}:{REVISION}" for service in SERVICES}
        digests = {service: f"sha256:{index:064x}" for index, service in enumerate(SERVICES, start=1)}
        manifest = build_manifest(
            should_dispatch=True,
            environment="staging",
            source_repository="akoita/resonate",
            source_ref=REVISION,
            services_csv=",".join(SERVICES),
            trigger_branch="main",
            release_sha=REVISION,
            release_id="ci-123-4",
            image_tags=tags,
            image_digests=digests,
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            write_manifest(path, manifest)
            result = subprocess.run(
                [sys.executable, str(SCRIPTS / "export-deploy-intent.py"), str(path)],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        exported = {}
        for line in result.stdout.splitlines():
            key, value = line.split("=", 1)
            exported[key] = shlex.split(value)[0] if value else ""
        self.assertEqual(exported["schema_version"], "resonate-deploy-manifest/v2")
        self.assertEqual(exported["stable_audio_image_digest"], digests["stable-audio"])
        self.assertEqual(exported["stable_audio_image_ref"], manifest["stable_audio_image_ref"])
        self.assertEqual(exported["should_dispatch"], "true")

    def test_rejects_legacy_or_unvalidated_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text('{"should_dispatch": true}\n', encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SCRIPTS / "export-deploy-intent.py"), str(path)],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("Invalid deploy manifest", result.stderr)


if __name__ == "__main__":
    unittest.main()
