from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

IMAGE_SPEC = importlib.util.spec_from_file_location("image_evidence", SCRIPTS / "image_evidence.py")
assert IMAGE_SPEC and IMAGE_SPEC.loader
image_evidence = importlib.util.module_from_spec(IMAGE_SPEC)
sys.modules[IMAGE_SPEC.name] = image_evidence
IMAGE_SPEC.loader.exec_module(image_evidence)

RELEASE_SPEC = importlib.util.spec_from_file_location("release_evidence", SCRIPTS / "release_evidence.py")
assert RELEASE_SPEC and RELEASE_SPEC.loader
release_evidence = importlib.util.module_from_spec(RELEASE_SPEC)
sys.modules[RELEASE_SPEC.name] = release_evidence
RELEASE_SPEC.loader.exec_module(release_evidence)


REVISION = "a" * 40
VERSION = "1.2.3-rc.1"
SERVICES = ("backend", "frontend")
DIGESTS = {service: f"sha256:{index:064x}" for index, service in enumerate(SERVICES, start=1)}
TAGS = {
    service: f"europe-docker.pkg.dev/project/resonate/{service}:{REVISION}"
    for service in SERVICES
}


class ReleaseFixture:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.manifest_path = root / "deploy-manifest.json"
        self.evidence_root = root / "image-evidence"
        manifest = image_evidence.build_manifest(
            should_dispatch=True,
            environment="staging",
            source_repository="akoita/resonate",
            source_ref=REVISION,
            services_csv=",".join(SERVICES),
            trigger_branch="main",
            release_sha=REVISION,
            release_id="ci-123-4",
            image_tags=TAGS,
            image_digests=DIGESTS,
        )
        image_evidence.write_manifest(self.manifest_path, manifest)
        for service in SERVICES:
            self.write_service(service)

    def write_service(self, service: str, **metadata_overrides: str) -> None:
        service_dir = self.evidence_root / service
        service_dir.mkdir(parents=True, exist_ok=True)
        immutable_ref = f"{TAGS[service].rsplit(':', 1)[0]}@{DIGESTS[service]}"
        metadata = {
            "immutable_ref": immutable_ref,
            "source_sha": REVISION,
            "digest": DIGESTS[service],
            "cloud_build_id": f"build-{service}",
            **metadata_overrides,
        }
        documents = {
            f"{service}.build.json": metadata,
            f"{service}.sbom.cdx.json": {
                "bomFormat": "CycloneDX",
                "components": [{"name": service, "version": VERSION}],
            },
            f"{service}.signature-verification.json": [{"verified": True}],
            f"{service}.attestation-verification.json": [{"verified": True, "type": "cyclonedx"}],
            f"{service}.build-attestation-verification.json": [{"verified": True, "type": "build"}],
        }
        for filename, document in documents.items():
            (service_dir / filename).write_text(
                json.dumps(document, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )

    def build(self, **overrides: object) -> dict[str, object]:
        values: dict[str, object] = {
            "deploy_manifest_path": self.manifest_path,
            "image_evidence_root": self.evidence_root,
            "source_sha": REVISION,
            "version": VERSION,
            "ci_run_id": "123",
            "ci_run_url": "https://github.com/akoita/resonate/actions/runs/123",
            "release_pr_url": "https://github.com/akoita/resonate/pull/456",
        }
        values.update(overrides)
        return release_evidence.build_release_evidence(**values)


class ReleaseEvidenceTests(unittest.TestCase):
    def test_valid_fixture_builds_complete_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = ReleaseFixture(Path(directory))
            document = fixture.build()

        self.assertEqual(document["schema_version"], "resonate-release-evidence/v1")
        self.assertEqual(document["tag"], f"v{VERSION}")
        self.assertEqual(document["deployment"]["status"], "handoff-requested")
        self.assertEqual(document["analytics"], {"status": "not-performed"})
        self.assertEqual(document["contracts"], {"status": "not-performed"})
        self.assertEqual(document["services"]["backend"]["digest"], DIGESTS["backend"])
        self.assertEqual(len(document["services"]["backend"]["evidence_files"]), 5)
        for evidence in document["services"]["backend"]["evidence_files"].values():
            self.assertRegex(evidence["sha256"], r"^[0-9a-f]{64}$")

    def test_rejects_source_and_version_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = ReleaseFixture(Path(directory))
            with self.assertRaisesRegex(release_evidence.ReleaseEvidenceError, "source_ref"):
                fixture.build(source_sha="b" * 40)
            for invalid in ("v1.2.3", "01.2.3", "1.2", "1.2.3-01", "1.2.3+build"):
                with self.subTest(version=invalid):
                    with self.assertRaisesRegex(release_evidence.ReleaseEvidenceError, "strict"):
                        fixture.build(version=invalid)

    def test_rejects_missing_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = ReleaseFixture(Path(directory))
            missing = fixture.evidence_root / "frontend" / "frontend.attestation-verification.json"
            missing.unlink()
            with self.assertRaisesRegex(release_evidence.ReleaseEvidenceError, "attestation"):
                fixture.build()

    def test_rejects_wrong_build_digest_and_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = ReleaseFixture(Path(directory))
            fixture.write_service("backend", digest=f"sha256:{9:064x}")
            with self.assertRaisesRegex(release_evidence.ReleaseEvidenceError, "digest mismatch"):
                fixture.build()

        with tempfile.TemporaryDirectory() as directory:
            fixture = ReleaseFixture(Path(directory))
            fixture.write_service("backend", source_sha="b" * 40)
            with self.assertRaisesRegex(release_evidence.ReleaseEvidenceError, "source SHA mismatch"):
                fixture.build()

    def test_output_is_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = ReleaseFixture(Path(directory))
            first = fixture.build()
            second = fixture.build()
            first_path = Path(directory) / "first.json"
            second_path = Path(directory) / "second.json"
            release_evidence.write_json(first_path, first)
            release_evidence.write_json(second_path, second)
            self.assertEqual(first, second)
            self.assertEqual(first_path.read_bytes(), second_path.read_bytes())

    def test_render_notes_preserves_categories_and_completes_sections(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = ReleaseFixture(root)
            evidence_path = root / "release-evidence.json"
            release_evidence.write_json(evidence_path, fixture.build())
            generated_path = root / "generated.json"
            generated_path.write_text(
                json.dumps(
                    {
                        "categories": {
                            "Summary": "A release-bound summary (#0)",
                            "User-visible changes": ["Added the browse view (#1)"],
                            "Security": "- Hardened the release gate (#2)",
                            "Documentation and maintenance": ["Updated the operator runbook (#4)"],
                            "Other changes": "- Recorded an internal cleanup (#5)",
                            "Rollback and recovery": "- Documented the last-known-good rollback (#6)",
                        },
                        "body": "## API and contract changes\n\n- Added v2 contract (#3)\n",
                    }
                ),
                encoding="utf-8",
            )
            notes = release_evidence.render_notes(
                generated_notes_path=generated_path,
                evidence_path=evidence_path,
            )

        for heading in release_evidence.REQUIRED_NOTE_HEADINGS:
            self.assertEqual(notes.count(f"## {heading}\n"), 1)
        self.assertIn("Added the browse view (#1)", notes)
        self.assertIn("Added v2 contract (#3)", notes)
        self.assertIn("Hardened the release gate (#2)", notes)
        self.assertIn("A release-bound summary (#0)", notes)
        self.assertIn("Updated the operator runbook (#4)", notes)
        self.assertIn("Recorded an internal cleanup (#5)", notes)
        self.assertIn("Documented the last-known-good rollback (#6)", notes)
        self.assertIn(f"Source commit: `{REVISION}`", notes)
        self.assertIn("[123](https://github.com/akoita/resonate/actions/runs/123)", notes)
        self.assertIn("https://github.com/akoita/resonate/pull/456", notes)
        self.assertIn("backend@sha256", notes)
        self.assertGreaterEqual(notes.count("None"), 3)

        heading_positions = [notes.index(f"## {heading}\n") for heading in release_evidence.REQUIRED_NOTE_HEADINGS]
        self.assertEqual(heading_positions, sorted(heading_positions))


if __name__ == "__main__":
    unittest.main()
