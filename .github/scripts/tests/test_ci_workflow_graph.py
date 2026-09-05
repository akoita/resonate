"""Protect required check identities and real producer/consumer dependencies."""
from pathlib import Path
import re
import sys
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import workflow_trigger_policy


class WorkflowGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = SCRIPTS.parent / "workflows/ci.yml"
        cls.jobs = dict(workflow_trigger_policy._workflow_job_blocks(path.read_text(), path=path))

    def needs(self, job):
        line = re.search(r"^    needs: (.+)$", self.jobs[job], re.MULTILINE)
        self.assertIsNotNone(line)
        return set(line.group(1).strip("[]").replace(" ", "").split(","))

    def test_required_check_names_stay_stable(self):
        required = {"Detect Changes", "Lint", "Smart Contract Tests", "Backend Unit Tests",
                    "Backend Integration Tests", "Backend Tests", "Build", "E2E Tests",
                    "Demucs Worker Tests"}
        names = {re.search(r"^    name: (.+)$", text, re.MULTILINE).group(1)
                 for text in self.jobs.values()}
        self.assertTrue(required <= names)

    def test_independent_validation_does_not_wait_for_lint(self):
        for job in ["backend-unit-tests", "backend-integration-tests", "build", "desktop-package"]:
            with self.subTest(job=job):
                self.assertEqual(self.needs(job), {"changes"})

    def test_artifact_and_aggregate_dependencies_remain(self):
        self.assertEqual(self.needs("e2e-tests"), {"changes", "build"})
        self.assertEqual(self.needs("backend-tests"),
                         {"changes", "backend-unit-tests", "backend-integration-tests"})
        self.assertEqual(self.needs("build-deployable-frontend"), {"changes", "lint"})
        self.assertIn("needs.lint.result == 'success'", self.jobs["build-deployable-frontend"])


if __name__ == "__main__":
    unittest.main()
