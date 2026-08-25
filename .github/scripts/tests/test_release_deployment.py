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
    "release_deployment",
    SCRIPTS / "release_deployment.py",
)
assert SPEC and SPEC.loader
release_deployment = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = release_deployment
SPEC.loader.exec_module(release_deployment)


REVISION = "a" * 40


def ci_run(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "id": 123456,
        "name": "CI",
        "status": "completed",
        "conclusion": "success",
        "event": "push",
        "head_branch": "develop",
        "head_sha": REVISION,
        "run_number": 99,
        "html_url": "https://github.com/akoita/resonate/actions/runs/123456",
    }
    value.update(overrides)
    return value


def build_plan(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "mode": "preview",
        "release_kind": "planned",
        "source_sha": REVISION,
        "environment": "dev",
        "services_csv": "frontend, backend",
        "deploy": False,
        "release_id": "planned-2026-08-25",
        "ci_run": ci_run(),
    }
    values.update(overrides)
    return release_deployment.build_plan(**values)


class ReleaseDeploymentTests(unittest.TestCase):
    def test_planned_preview_normalizes_services_and_does_not_dispatch(self) -> None:
        plan = build_plan()
        self.assertEqual(plan["schema_version"], release_deployment.SCHEMA_VERSION)
        self.assertEqual(plan["services"], ["backend", "frontend"])
        self.assertEqual(plan["services_csv"], "backend,frontend")
        self.assertEqual(plan["source_branch"], "develop")
        self.assertEqual(plan["ci_run_id"], 123456)
        self.assertFalse(plan["should_dispatch"])

    def test_on_demand_publish_deploys_selected_services(self) -> None:
        plan = build_plan(
            mode="publish",
            release_kind="on-demand",
            services_csv="stable-audio,demucs",
            deploy=True,
            release_id="operator_retry-1",
        )
        self.assertEqual(plan["services"], ["demucs", "stable-audio"])
        self.assertTrue(plan["deploy"])
        self.assertTrue(plan["should_dispatch"])

    def test_rejects_malformed_source_sha(self) -> None:
        for source_sha in ("a" * 39, "A" * 40, "g" * 40, "a" * 40 + " "):
            with self.subTest(source_sha=source_sha):
                with self.assertRaisesRegex(
                    release_deployment.ReleaseDeploymentError,
                    "source_sha",
                ):
                    build_plan(source_sha=source_sha)

    def test_rejects_invalid_ci_run_metadata(self) -> None:
        cases = (
            ("name", "Not CI", "workflow name"),
            ("status", "in_progress", "status"),
            ("conclusion", "failure", "conclusion"),
            ("event", "pull_request", "event"),
            ("id", 0, "positive numeric"),
            ("head_sha", "b" * 40, "head_sha"),
        )
        for field, value, message in cases:
            with self.subTest(field=field):
                with self.assertRaisesRegex(
                    release_deployment.ReleaseDeploymentError,
                    message,
                ):
                    build_plan(ci_run=ci_run(**{field: value}))

    def test_rejects_branch_environment_mismatch(self) -> None:
        with self.assertRaisesRegex(
            release_deployment.ReleaseDeploymentError,
            "maps to environment",
        ):
            build_plan(
                environment="staging",
                ci_run=ci_run(head_branch="develop"),
            )

        with self.assertRaisesRegex(
            release_deployment.ReleaseDeploymentError,
            "develop or main",
        ):
            build_plan(ci_run=ci_run(head_branch="feature/release"))

    def test_rejects_invalid_or_duplicate_services(self) -> None:
        for services, message in (
            ("", "non-empty"),
            ("backend,", "non-empty"),
            ("backend,backend", "duplicates"),
            ("backend,unknown", "unsupported"),
        ):
            with self.subTest(services=services):
                with self.assertRaisesRegex(
                    release_deployment.ReleaseDeploymentError,
                    message,
                ):
                    build_plan(services_csv=services)

    def test_rejects_deploy_during_preview(self) -> None:
        with self.assertRaisesRegex(
            release_deployment.ReleaseDeploymentError,
            "mode=publish",
        ):
            build_plan(deploy=True)

    def test_rejects_unsafe_release_id(self) -> None:
        for release_id in ("", "release with spaces", "../release", "a\nset=b"):
            with self.subTest(release_id=release_id):
                with self.assertRaisesRegex(
                    release_deployment.ReleaseDeploymentError,
                    "release_id",
                ):
                    build_plan(release_id=release_id)

    def test_plan_json_is_stable(self) -> None:
        first = build_plan()
        second = build_plan()
        self.assertEqual(first, second)
        with tempfile.TemporaryDirectory() as directory:
            first_path = Path(directory) / "first.json"
            second_path = Path(directory) / "second.json"
            release_deployment.write_plan(first_path, first)
            release_deployment.write_plan(second_path, second)
            self.assertEqual(first_path.read_bytes(), second_path.read_bytes())
            self.assertEqual(json.loads(first_path.read_text()), first)

    def test_cli_writes_plan_and_github_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ci_path = root / "ci-run.json"
            output_path = root / "plan.json"
            github_output = root / "github-output"
            ci_path.write_text(json.dumps(ci_run()), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "release_deployment.py"),
                    "validate",
                    "--mode",
                    "publish",
                    "--release-kind",
                    "on-demand",
                    "--source-sha",
                    REVISION,
                    "--environment",
                    "dev",
                    "--services",
                    "frontend, backend",
                    "--deploy",
                    "true",
                    "--release-id",
                    "operator-1",
                    "--ci-run-json",
                    str(ci_path),
                    "--output",
                    str(output_path),
                    "--github-output",
                    str(github_output),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            plan = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertTrue(plan["should_dispatch"])
            outputs = github_output.read_text(encoding="utf-8")
            self.assertIn("services=backend,frontend\n", outputs)
            self.assertIn("services_csv=backend,frontend\n", outputs)
            self.assertIn("should_dispatch=true\n", outputs)

    def test_cli_does_not_echo_ci_json_on_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ci_path = root / "ci-run.json"
            ci_path.write_text(
                json.dumps({**ci_run(), "token": "do-not-print-this"}),
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "release_deployment.py"),
                    "validate",
                    "--mode",
                    "preview",
                    "--release-kind",
                    "planned",
                    "--source-sha",
                    "b" * 40,
                    "--environment",
                    "dev",
                    "--services",
                    "backend",
                    "--deploy",
                    "false",
                    "--release-id",
                    "safe-id",
                    "--ci-run-json",
                    str(ci_path),
                    "--output",
                    str(root / "plan.json"),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 1)
            self.assertNotIn("do-not-print-this", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
