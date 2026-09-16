"""Keep scheduled workflows from failing into silence (#1766).

Four of six scheduled workflows reported their failures to nobody. Mutation
testing was red every Monday for six weeks before anyone counted the Mondays,
and Dependency Train had never once succeeded. These tests keep the reporting
wired, keep it off the pull-request path, and keep the one deliberate
inconsistency from being tidied away.
"""
from pathlib import Path
import sys
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import workflow_trigger_policy

WORKFLOWS = SCRIPTS.parent / "workflows"
ACTION = SCRIPTS.parent / "actions/report-scheduled-failure/action.yml"

# workflow file -> the job whose result the report job reports on.
SCHEDULE_ONLY = {
    "certora.yml": "certora",
    "mutation.yml": "mutation",
    "dependency-train.yml": "rebuild",
    "security.yml": "nightly",
}


def _jobs(name):
    path = WORKFLOWS / name
    return dict(workflow_trigger_policy._workflow_job_blocks(path.read_text(encoding="utf-8"), path=path))


class ScheduledFailureReportingTests(unittest.TestCase):
    def test_shared_action_exists(self):
        self.assertTrue(ACTION.is_file(), f"missing composite action: {ACTION}")

    def test_action_handles_both_outcomes(self):
        text = ACTION.read_text(encoding="utf-8")
        # A failure that opens an issue but never closes it leaves a stale trace
        # that stops meaning anything; both halves have to exist.
        self.assertIn("gh issue create", text)
        self.assertIn("gh issue comment", text)
        self.assertIn("gh issue close", text)

    def test_every_scheduled_workflow_reports(self):
        for workflow, upstream in SCHEDULE_ONLY.items():
            with self.subTest(workflow=workflow):
                jobs = _jobs(workflow)
                self.assertIn("report-failure", jobs, f"{workflow} reports its failures to nobody")
                report = jobs["report-failure"]
                self.assertIn("uses: ./.github/actions/report-scheduled-failure", report)
                self.assertIn("issues: write", report)
                self.assertIn(f"needs.{upstream}.result == 'success'", report)

    def test_scheduled_workflows_do_not_report_off_the_schedule(self):
        # A manual dispatch has a human watching it, and security.yml also runs
        # on pull requests where a failure already blocks the PR. Reporting
        # either would be noise on every red PR.
        for workflow in SCHEDULE_ONLY:
            with self.subTest(workflow=workflow):
                report = _jobs(workflow)["report-failure"]
                self.assertIn("github.event_name == 'schedule'", report)
                self.assertNotIn("workflow_dispatch", report)
                self.assertNotIn("pull_request", report)

    def test_reporting_never_widens_a_workflows_permissions(self):
        # The reporting job carries issues: write; nothing else should have
        # gained write access when it was added.
        for workflow in SCHEDULE_ONLY:
            with self.subTest(workflow=workflow):
                text = (WORKFLOWS / workflow).read_text(encoding="utf-8")
                for line in text.splitlines():
                    self.assertIsNone(
                        workflow_trigger_policy._ID_TOKEN_WRITE.fullmatch(line),
                        f"{workflow} must not grant id-token: write",
                    )


if __name__ == "__main__":
    unittest.main()
