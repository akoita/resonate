from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "release_deploy_gate",
    SCRIPTS / "release_deploy_gate.py",
)
assert SPEC and SPEC.loader
release_deploy_gate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = release_deploy_gate
SPEC.loader.exec_module(release_deploy_gate)


REVISION = "a" * 40
TAG = "v1.2.3"
IMAGE_RUN_ID = "789"


def release_document(**overrides: object) -> dict[str, object]:
    document: dict[str, object] = {
        "tagName": TAG,
        "targetCommitish": REVISION,
        "isDraft": False,
        "isPrerelease": False,
    }
    document.update(overrides)
    return document


def tag_ref(**overrides: object) -> dict[str, object]:
    document: dict[str, object] = {
        "ref": f"refs/tags/{TAG}",
        "object": {"sha": REVISION, "type": "commit"},
    }
    document.update(overrides)
    return document


def evidence_document(**overrides: object) -> dict[str, object]:
    document: dict[str, object] = {
        "schema_version": "resonate-release-evidence/v2",
        "tag": TAG,
        "source_sha": REVISION,
        "image_run": {"id": IMAGE_RUN_ID},
        "deployment": {"environment": "staging", "trigger_branch": "main"},
    }
    document.update(overrides)
    return document


def evaluate(**overrides: object) -> release_deploy_gate.GateDecision:
    values: dict[str, object] = {
        "event_name": "push",
        "event_ref": f"refs/tags/{TAG}",
        "event_ref_name": TAG,
        "release_tag": TAG,
        "release": release_document(),
        "tag_ref": tag_ref(),
        "release_evidence": evidence_document(),
    }
    values.update(overrides)
    return release_deploy_gate.evaluate_published_release(**values)


class ReleaseDeployGateTests(unittest.TestCase):
    def test_stable_published_tag_is_eligible(self) -> None:
        decision = evaluate()
        self.assertTrue(decision.eligible)
        self.assertEqual(decision.release_tag, TAG)
        self.assertEqual(decision.source_sha, REVISION)
        self.assertEqual(decision.image_run_id, IMAGE_RUN_ID)
        self.assertEqual(decision.reason, "eligible")

    def test_manual_and_non_tag_contexts_are_ineligible(self) -> None:
        for overrides in (
            {"event_name": "workflow_dispatch"},
            {"event_ref": "refs/heads/main", "event_ref_name": "main"},
        ):
            with self.subTest(overrides=overrides):
                decision = evaluate(**overrides)
                self.assertFalse(decision.eligible)

    def test_prerelease_build_and_milestone_tags_are_ineligible(self) -> None:
        for release_tag in ("v1.2.3-rc.1", "v1.2.3+build.1", "milestone-2026-08"):
            with self.subTest(release_tag=release_tag):
                decision = evaluate(
                    release_tag=release_tag,
                    event_ref=f"refs/tags/{release_tag}",
                    event_ref_name=release_tag,
                    release=release_document(tagName=release_tag),
                    tag_ref={
                        "ref": f"refs/tags/{release_tag}",
                        "object": {"sha": REVISION, "type": "commit"},
                    },
                    release_evidence=evidence_document(tag=release_tag),
                )
                self.assertFalse(decision.eligible)

    def test_draft_and_prerelease_metadata_is_rejected(self) -> None:
        for field, value in (("isDraft", True), ("isPrerelease", True)):
            with self.subTest(field=field):
                self.assertFalse(evaluate(release=release_document(**{field: value})).eligible)

    def test_tag_and_evidence_sha_must_match(self) -> None:
        self.assertFalse(
            evaluate(
                tag_ref={
                    "ref": f"refs/tags/{TAG}",
                    "object": {"sha": "b" * 40, "type": "commit"},
                }
            ).eligible
        )
        self.assertFalse(evaluate(release_evidence=evidence_document(source_sha="b" * 40)).eligible)
        self.assertFalse(evaluate(expected_source_sha="b" * 40).eligible)

    def test_only_main_staging_manifest_can_enter_automatic_path(self) -> None:
        self.assertFalse(
            evaluate(
                release_evidence=evidence_document(
                    deployment={"environment": "dev", "trigger_branch": "develop"}
                )
            ).eligible
        )

    def test_image_run_id_must_be_positive_and_match_when_supplied(self) -> None:
        for value in ("0", "-1", "", "abc"):
            with self.subTest(value=value):
                self.assertFalse(
                    evaluate(release_evidence=evidence_document(image_run={"id": value})).eligible
                )
        self.assertFalse(evaluate(expected_image_run_id="790").eligible)
        self.assertTrue(evaluate(expected_image_run_id=IMAGE_RUN_ID).eligible)

    def test_cli_writes_workflow_outputs_and_can_require_eligibility(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {
                "release": root / "release.json",
                "tag": root / "tag.json",
                "evidence": root / "release-evidence.json",
                "output": root / "github-output",
            }
            paths["release"].write_text(json.dumps(release_document()), encoding="utf-8")
            paths["tag"].write_text(json.dumps(tag_ref()), encoding="utf-8")
            paths["evidence"].write_text(json.dumps(evidence_document()), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "release_deploy_gate.py"),
                    "--release-json",
                    str(paths["release"]),
                    "--tag-ref-json",
                    str(paths["tag"]),
                    "--release-evidence",
                    str(paths["evidence"]),
                    "--release-tag",
                    TAG,
                    "--event-name",
                    "push",
                    "--event-ref",
                    f"refs/tags/{TAG}",
                    "--event-ref-name",
                    TAG,
                    "--github-output",
                    str(paths["output"]),
                    "--require-eligible",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            outputs = paths["output"].read_text(encoding="utf-8")
            self.assertIn(f"release_tag={TAG}\n", outputs)
            self.assertIn(f"source_sha={REVISION}\n", outputs)
            self.assertIn(f"image_run_id={IMAGE_RUN_ID}\n", outputs)
            self.assertIn("automatic_handoff_eligible=true\n", outputs)

            manual = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "release_deploy_gate.py"),
                    "--release-json",
                    str(paths["release"]),
                    "--tag-ref-json",
                    str(paths["tag"]),
                    "--release-evidence",
                    str(paths["evidence"]),
                    "--release-tag",
                    TAG,
                    "--event-name",
                    "workflow_dispatch",
                    "--event-ref",
                    "refs/heads/main",
                    "--event-ref-name",
                    "main",
                    "--require-eligible",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(manual.returncode, 1)
            self.assertIn("tag-push context", manual.stderr)


if __name__ == "__main__":
    unittest.main()
