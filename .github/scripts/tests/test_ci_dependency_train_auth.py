"""Keep Dependency Train publication scoped to its dedicated GitHub App."""

from pathlib import Path
import re
import unittest


WORKFLOW = Path(__file__).resolve().parents[2] / "workflows/dependency-train.yml"


class DependencyTrainAuthTests(unittest.TestCase):
    def test_rebuild_uses_a_pinned_github_app_token(self):
        text = WORKFLOW.read_text(encoding="utf-8")

        self.assertRegex(
            text,
            r"uses: actions/create-github-app-token@[0-9a-f]{40} # v\d+\.\d+\.\d+",
        )
        self.assertIn("app-id: ${{ secrets.DEPENDENCY_TRAIN_APP_ID }}", text)
        self.assertIn(
            "private-key: ${{ secrets.DEPENDENCY_TRAIN_APP_PRIVATE_KEY }}",
            text,
        )
        self.assertIn("permission-contents: write", text)
        self.assertIn("permission-pull-requests: write", text)

    def test_rebuild_never_falls_back_to_the_default_workflow_token(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        rebuild = text.split("  report-failure:", maxsplit=1)[0]

        app_token = "${{ steps.dependency-train-token.outputs.token }}"
        self.assertEqual(rebuild.count(f"GH_TOKEN: {app_token}"), 2)
        self.assertNotIn("GH_TOKEN: ${{ github.token }}", rebuild)

    def test_app_token_is_not_persisted_by_checkout(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        rebuild = text.split("  report-failure:", maxsplit=1)[0]

        self.assertRegex(rebuild, re.compile(r"persist-credentials:\s+false"))


if __name__ == "__main__":
    unittest.main()
