from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "workflow_trigger_policy",
    SCRIPTS / "workflow_trigger_policy.py",
)
assert SPEC and SPEC.loader
workflow_trigger_policy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(workflow_trigger_policy)


WORKFLOW_FIXTURES = {
    "release-deployment.yml": """\
name: Release Deployment
on:
  workflow_dispatch:
    inputs:
      mode:
        required: true
jobs:
  release:
    runs-on: ubuntu-latest
    steps: []
""",
    "publish-deployable-images.yml": """\
name: Publish Deployable Images
on:
  workflow_call:
    inputs: {}
jobs:
  publish:
    runs-on: ubuntu-latest
    steps: []
""",
    "deploy-handoff.yml": """\
name: Deploy Handoff
on:
  workflow_call:
    inputs:
      automatic_published_release:
        required: false
  workflow_dispatch:
    inputs: {}
jobs:
  handoff:
    runs-on: ubuntu-latest
    steps: []
""",
    "desktop-release.yml": """\
name: Desktop Release Artifacts
on:
  push:
    tags:
      - "v*"
  workflow_dispatch:
    inputs: {}
jobs:
  release:
    runs-on: ubuntu-latest
    steps: []
""",
    "publish-analytics-dataflow-flex-template.yml": """\
name: Publish Analytics Dataflow Flex Template
on:
  workflow_dispatch:
    inputs: {}
jobs:
  publish:
    runs-on: ubuntu-latest
    steps: []
""",
    "software-release.yml": """\
name: Software Release
on:
  workflow_dispatch:
    inputs: {}
jobs:
  release:
    runs-on: ubuntu-latest
    steps: []
""",
    "ci.yml": """\
name: CI
on:
  push:
  pull_request:
  workflow_call:
permissions:
  contents: read
jobs:
  checks:
    name: Validation
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  build-deployable-frontend:
    name: Build Deployable Frontend Artifact
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
""",
}


def write_workflow_fixture(root: Path, **overrides: str) -> Path:
    for filename, content in WORKFLOW_FIXTURES.items():
        (root / filename).write_text(overrides.get(filename, content), encoding="utf-8")
    return root


class WorkflowTriggerPolicyTests(unittest.TestCase):
    def test_valid_fixture_repository_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(Path(directory))
            workflow_trigger_policy.validate_repository(root)

    def test_release_deployment_must_be_dispatch_only(self) -> None:
        invalid = WORKFLOW_FIXTURES["release-deployment.yml"].replace(
            "  workflow_dispatch:\n",
            "  push:\n  workflow_dispatch:\n",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(Path(directory), **{"release-deployment.yml": invalid})
            with self.assertRaisesRegex(
                workflow_trigger_policy.WorkflowTriggerPolicyError,
                "release-deployment.yml: trigger events must be exactly",
            ):
                workflow_trigger_policy.validate_repository(root)

    def test_publish_deployable_images_must_be_reusable_only(self) -> None:
        invalid = WORKFLOW_FIXTURES["publish-deployable-images.yml"].replace(
            "  workflow_call:\n",
            "  workflow_dispatch:\n  workflow_call:\n",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(
                Path(directory),
                **{"publish-deployable-images.yml": invalid},
            )
            with self.assertRaisesRegex(
                workflow_trigger_policy.WorkflowTriggerPolicyError,
                "publish-deployable-images.yml: trigger events must be exactly",
            ):
                workflow_trigger_policy.validate_repository(root)

    def test_deploy_handoff_must_not_use_workflow_run_or_ci_target(self) -> None:
        invalid = WORKFLOW_FIXTURES["deploy-handoff.yml"].replace(
            "  workflow_call:\n    inputs:\n      automatic_published_release:\n        required: false\n",
            '  workflow_run:\n    workflows: ["CI"]\n    types: [completed]\n',
        )
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(Path(directory), **{"deploy-handoff.yml": invalid})
            with self.assertRaisesRegex(
                workflow_trigger_policy.WorkflowTriggerPolicyError,
                "trigger events must be exactly",
            ):
                workflow_trigger_policy.validate_repository(root)

    def test_deploy_handoff_must_keep_both_allowed_trigger_types(self) -> None:
        invalid = WORKFLOW_FIXTURES["deploy-handoff.yml"].replace(
            "  workflow_dispatch:\n    inputs: {}\n",
            "",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(Path(directory), **{"deploy-handoff.yml": invalid})
            with self.assertRaisesRegex(
                workflow_trigger_policy.WorkflowTriggerPolicyError,
                "deploy-handoff.yml: trigger events must be exactly",
            ):
                workflow_trigger_policy.validate_repository(root)

    def test_deploy_handoff_automatic_mode_is_workflow_call_only(self) -> None:
        invalid = WORKFLOW_FIXTURES["deploy-handoff.yml"].replace(
            "      automatic_published_release:\n        required: false\n",
            "",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(Path(directory), **{"deploy-handoff.yml": invalid})
            with self.assertRaisesRegex(
                workflow_trigger_policy.WorkflowTriggerPolicyError,
                "automatic published-release mode must be workflow_call-only",
            ):
                workflow_trigger_policy.validate_repository(root)

    def test_desktop_release_requires_v_tag_push_and_manual_dispatch(self) -> None:
        invalid = WORKFLOW_FIXTURES["desktop-release.yml"].replace(
            '      - "v*"',
            '      - "*"',
        )
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(Path(directory), **{"desktop-release.yml": invalid})
            with self.assertRaisesRegex(
                workflow_trigger_policy.WorkflowTriggerPolicyError,
                "desktop push trigger must contain exactly the v\\* tag pattern",
            ):
                workflow_trigger_policy.validate_repository(root)

    def test_desktop_release_rejects_generic_release_event(self) -> None:
        invalid = WORKFLOW_FIXTURES["desktop-release.yml"].replace(
            "  workflow_dispatch:\n",
            "  release:\n  workflow_dispatch:\n",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(Path(directory), **{"desktop-release.yml": invalid})
            with self.assertRaisesRegex(
                workflow_trigger_policy.WorkflowTriggerPolicyError,
                "desktop-release.yml: trigger events must be exactly",
            ):
                workflow_trigger_policy.validate_repository(root)

    def test_analytics_and_software_release_must_be_dispatch_only(self) -> None:
        for filename in (
            "publish-analytics-dataflow-flex-template.yml",
            "software-release.yml",
        ):
            with self.subTest(filename=filename):
                invalid = WORKFLOW_FIXTURES[filename].replace(
                    "  workflow_dispatch:\n",
                    "  push:\n  workflow_dispatch:\n",
                )
                with tempfile.TemporaryDirectory() as directory:
                    root = write_workflow_fixture(Path(directory), **{filename: invalid})
                    with self.assertRaisesRegex(
                        workflow_trigger_policy.WorkflowTriggerPolicyError,
                        f"{filename}: trigger events must be exactly",
                    ):
                        workflow_trigger_policy.validate_repository(root)

    def test_ci_rejects_id_token_write(self) -> None:
        invalid = WORKFLOW_FIXTURES["ci.yml"].replace(
            "permissions:\n  contents: read\n",
            "permissions:\n  contents: read\n  id-token: write\n",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(Path(directory), **{"ci.yml": invalid})
            with self.assertRaisesRegex(workflow_trigger_policy.WorkflowTriggerPolicyError, "id-token"):
                workflow_trigger_policy.validate_repository(root)

    def test_ci_rejects_image_publishing_or_deployment_job(self) -> None:
        invalid = WORKFLOW_FIXTURES["ci.yml"].replace(
            "  checks:\n",
            "  publish-backend-image:\n    name: Publish Backend Image\n    runs-on: ubuntu-latest\n    steps:\n      - run: docker push example/image\n  checks:\n",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(Path(directory), **{"ci.yml": invalid})
            with self.assertRaisesRegex(workflow_trigger_policy.WorkflowTriggerPolicyError, "publish-backend-image"):
                workflow_trigger_policy.validate_repository(root)

    def test_ci_rejects_generic_deployment_job(self) -> None:
        invalid = WORKFLOW_FIXTURES["ci.yml"].replace(
            "  checks:\n",
            "  deploy:\n    name: Deploy Application\n    runs-on: ubuntu-latest\n    steps: []\n  checks:\n",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = write_workflow_fixture(Path(directory), **{"ci.yml": invalid})
            with self.assertRaisesRegex(
                workflow_trigger_policy.WorkflowTriggerPolicyError,
                "deploy",
            ):
                workflow_trigger_policy.validate_repository(root)

    def test_current_repository_workflow_policy(self) -> None:
        repository_root = Path(__file__).resolve().parents[3]
        workflow_trigger_policy.validate_repository(repository_root / ".github" / "workflows")

    def test_cli_defaults_to_repository_validation_without_subcommand(self) -> None:
        self.assertEqual(workflow_trigger_policy.main([]), 0)


if __name__ == "__main__":
    unittest.main()
