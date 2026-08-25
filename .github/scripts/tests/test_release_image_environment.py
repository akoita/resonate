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


WORKFLOW = Path(__file__).resolve().parents[2] / "workflows" / "publish-deployable-images.yml"
GCP_IMAGE_PUBLICATION_JOBS = {
    "publish-backend-image",
    "publish-frontend-image",
    "publish-demucs-image",
    "publish-stable-audio-image",
}


class ReleaseImageEnvironmentTests(unittest.TestCase):
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
