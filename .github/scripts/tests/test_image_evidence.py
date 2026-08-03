from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("image_evidence", SCRIPTS / "image_evidence.py")
assert SPEC and SPEC.loader
image_evidence = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = image_evidence
SPEC.loader.exec_module(image_evidence)


REVISION = "a" * 40
DIGESTS = {service: f"sha256:{index:064x}" for index, service in enumerate(image_evidence.SERVICES, start=1)}
TAGS = {
    "backend": f"europe-docker.pkg.dev/project/resonate/backend:{REVISION}",
    "frontend": f"europe-docker.pkg.dev/project/resonate/frontend:{REVISION}",
    "demucs": f"europe-docker.pkg.dev/project/resonate/demucs-worker:{REVISION}",
    "stable-audio": f"europe-docker.pkg.dev/project/resonate/stable-audio-worker:{REVISION}",
}


def build(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "should_dispatch": True,
        "environment": "staging",
        "source_repository": "akoita/resonate",
        "source_ref": REVISION,
        "services_csv": ",".join(image_evidence.SERVICES),
        "trigger_branch": "main",
        "release_sha": REVISION,
        "release_id": "ci-123-4",
        "image_tags": TAGS,
        "image_digests": DIGESTS,
    }
    values.update(overrides)
    return image_evidence.build_manifest(**values)


class ImageEvidenceTests(unittest.TestCase):
    def test_builds_deterministic_v2_manifest_for_all_services(self) -> None:
        first = build()
        second = build()
        self.assertEqual(first, second)
        self.assertEqual(first["schema_version"], image_evidence.SCHEMA_VERSION)
        self.assertEqual(first["stable_audio_image_digest"], DIGESTS["stable-audio"])
        self.assertEqual(
            first["stable_audio_image_ref"],
            f"europe-docker.pkg.dev/project/resonate/stable-audio-worker@{DIGESTS['stable-audio']}",
        )

    def test_selected_service_requires_tag_and_digest(self) -> None:
        for missing in ("image_tags", "image_digests"):
            with self.subTest(missing=missing):
                values = dict(TAGS if missing == "image_tags" else DIGESTS)
                values.pop("stable-audio")
                with self.assertRaisesRegex(image_evidence.ManifestError, "stable-audio"):
                    build(**{missing: values})

    def test_rejects_malformed_digest(self) -> None:
        digests = dict(DIGESTS)
        digests["backend"] = "sha256:not-a-digest"
        with self.assertRaisesRegex(image_evidence.ManifestError, "64 lowercase hex"):
            build(image_digests=digests)

    def test_rejects_tag_digest_mismatch_during_validation(self) -> None:
        manifest = build()
        manifest["backend_image_ref"] = f"example.invalid/backend@{DIGESTS['backend']}"
        with self.assertRaisesRegex(image_evidence.ManifestError, "backend_image_ref"):
            image_evidence.validate_manifest(manifest)

    def test_unselected_services_are_empty(self) -> None:
        manifest = build(
            services_csv="backend",
            image_tags={"backend": TAGS["backend"]},
            image_digests={"backend": DIGESTS["backend"]},
        )
        self.assertEqual(manifest["backend_image_ref"], f"europe-docker.pkg.dev/project/resonate/backend@{DIGESTS['backend']}")
        self.assertEqual(manifest["stable_audio_image_ref"], "")

    def test_written_manifest_is_stable_and_valid(self) -> None:
        manifest = build()
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.json"
            second = Path(directory) / "second.json"
            image_evidence.write_manifest(first, manifest)
            image_evidence.write_manifest(second, manifest)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(image_evidence.load_manifest(first), manifest)
            self.assertEqual(json.loads(first.read_text()), manifest)


if __name__ == "__main__":
    unittest.main()
