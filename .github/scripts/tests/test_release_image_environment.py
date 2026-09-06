from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1]
POLICY_SPEC = importlib.util.spec_from_file_location(
    "workflow_trigger_policy",
    SCRIPTS / "workflow_trigger_policy.py",
)
assert POLICY_SPEC and POLICY_SPEC.loader
workflow_trigger_policy = importlib.util.module_from_spec(POLICY_SPEC)
POLICY_SPEC.loader.exec_module(workflow_trigger_policy)


WORKFLOWS = Path(__file__).resolve().parents[2] / "workflows"
RELEASE_WORKFLOW = WORKFLOWS / "release-deployment.yml"
WORKFLOW = WORKFLOWS / "publish-deployable-images.yml"
GCP_IMAGE_PUBLICATION_JOBS = {
    "publish-backend-image",
    "publish-frontend-image",
    "publish-demucs-image",
    "publish-stable-audio-image",
}


class ReleaseImageEnvironmentTests(unittest.TestCase):
    def test_dataflow_identity_matches_direct_dispatch_certificate_ref(self) -> None:
        workflow = WORKFLOWS / "publish-analytics-dataflow-flex-template.yml"
        text = workflow.read_text(encoding="utf-8")
        identity = next(line.split("workflow-identity:", 1)[1].strip()
                        for line in text.splitlines() if "workflow-identity:" in line)
        for branch in ("main", "develop"):
            with self.subTest(branch=branch):
                rendered = identity.replace("${{ github.repository }}", "akoita/resonate")
                rendered = rendered.replace("${{ github.ref }}", f"refs/heads/{branch}")
                rendered = rendered.replace("${{ inputs.source_sha }}", "a" * 40)
                # Direct workflow_dispatch certificates identify the workflow ref,
                # not the immutable commit used separately to validate image metadata.
                self.assertEqual(rendered, f"https://github.com/akoita/resonate/.github/workflows/{workflow.name}@refs/heads/{branch}")
        self.assertIn('if [[ "${SOURCE_SHA}" != "${DISPATCH_SHA}" ]]', text)
        self.assertIn('if [[ "${DISPATCH_BRANCH}" != "${expected_branch}" ]]', text)
        self.assertIn("source-sha: ${{ inputs.source_sha }}", text)

    def test_release_publish_images_forwards_environment_scoped_secrets(self) -> None:
        workflow_text = RELEASE_WORKFLOW.read_text(encoding="utf-8")
        jobs = dict(
            workflow_trigger_policy._workflow_job_blocks(  # noqa: SLF001
                workflow_text,
                path=RELEASE_WORKFLOW,
            )
        )

        publish_images = jobs.get("publish-images")
        self.assertIsNotNone(publish_images)
        assert publish_images is not None
        self.assertIn(
            "uses: ./.github/workflows/publish-deployable-images.yml",
            publish_images,
        )
        secret_lines = [
            line.strip()
            for line in publish_images.splitlines()
            if line.strip().startswith("secrets:")
        ]
        self.assertEqual(secret_lines, ["secrets: inherit"])

    def test_every_gcp_image_publication_job_uses_workflow_call_environment_input(self) -> None:
        workflow_text = WORKFLOW.read_text(encoding="utf-8")
        jobs = dict(
            workflow_trigger_policy._workflow_job_blocks(  # noqa: SLF001
                workflow_text,
                path=WORKFLOW,
            )
        )

        gcp_auth_jobs = {
            job_id: block
            for job_id, block in jobs.items()
            if "google-github-actions/auth@" in block
        }
        self.assertEqual(set(gcp_auth_jobs), GCP_IMAGE_PUBLICATION_JOBS)

        for job_id, block in gcp_auth_jobs.items():
            with self.subTest(job_id=job_id):
                environment_lines = [
                    line.strip()
                    for line in block.splitlines()
                    if line.strip().startswith("environment:")
                ]
                self.assertEqual(environment_lines, ["environment: ${{ inputs.environment }}"])


if __name__ == "__main__":
    unittest.main()
