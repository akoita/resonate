"""Keep the nightly full-validation workflow scheduled, complete, and unprivileged."""
from pathlib import Path
import re
import sys
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import workflow_trigger_policy

WORKFLOW = SCRIPTS.parent / "workflows/nightly-full-validation.yml"


class NightlyValidationWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WORKFLOW.read_text(encoding="utf-8")
        cls.events, _ = workflow_trigger_policy._trigger_events(cls.text, path=WORKFLOW)
        cls.jobs = dict(workflow_trigger_policy._workflow_job_blocks(cls.text, path=WORKFLOW))

    def test_workflow_exists(self):
        self.assertTrue(WORKFLOW.is_file(), f"missing workflow: {WORKFLOW}")

    def test_triggers_are_schedule_and_dispatch_only(self):
        # A repository-wide validation run must never be attached to the PR or
        # push path; those are already covered by CI itself.
        self.assertEqual(set(self.events), {"schedule", "workflow_dispatch"})
        self.assertNotIn("pull_request", self.events)
        self.assertNotIn("push", self.events)

    def test_schedule_declares_a_cron(self):
        cron = re.search(r'^\s*- cron: "([^"]+)"', self.text, re.MULTILINE)
        self.assertIsNotNone(cron, "nightly validation must declare a cron schedule")

    def test_validate_job_calls_ci_with_release_validation(self):
        validate = self.jobs["validate"]
        self.assertIn("uses: ./.github/workflows/ci.yml", validate)
        self.assertIn("release_validation: true", validate)

    def test_workflow_never_grants_id_token_write(self):
        # Validation-only, exactly like the CI workflow it calls: no cloud
        # credential minting, no publish or deploy step.
        for line in self.text.splitlines():
            self.assertIsNone(
                workflow_trigger_policy._ID_TOKEN_WRITE.fullmatch(line),
                "nightly validation must not grant id-token: write",
            )

    def test_failure_report_job_is_gated_and_branches_on_outcome(self):
        # #1766 moved this job onto the shared composite action, so it now runs
        # on every scheduled or dispatched run and decides inside the action
        # whether to open a failure issue or close a recovered one. The gate
        # that matters is therefore the outcome expression, not `failure()`:
        # without it a green run would report a failure.
        report = self.jobs["report-failure"]
        self.assertIn("needs: [validate]", report)
        self.assertIn("uses: ./.github/actions/report-scheduled-failure", report)
        self.assertIn("needs.validate.result == 'success'", report)
        self.assertIn("issues: write", report)
        self.assertIn("nightly-validation-failure", report)

    def test_failure_report_job_still_covers_manual_dispatch(self):
        # Deliberately broader than the four schedule-only workflows #1766
        # wired: this workflow's purpose is to be the pre-release gate an
        # operator dispatches before Release Deployment, so a dispatched run
        # deserves the same durable record. Narrowing it to schedule-only would
        # be a regression, not a tidy-up.
        report = self.jobs["report-failure"]
        self.assertIn("github.event_name == 'schedule'", report)
        self.assertIn("github.event_name == 'workflow_dispatch'", report)


if __name__ == "__main__":
    unittest.main()
