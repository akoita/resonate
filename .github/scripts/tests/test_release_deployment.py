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


def write_matrix(directory: str, document: object) -> Path:
    """Write a release environment matrix fixture and return its path."""
    path = Path(directory) / "release-environments.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


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
            services_csv="demucs,backend",
            deploy=True,
            release_id="operator_retry-1",
        )
        self.assertEqual(plan["services"], ["backend", "demucs"])
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

    def test_accepts_exact_sha_workflow_dispatch_ci_on_canonical_branch(self) -> None:
        plan = build_plan(
            environment="staging",
            ci_run=ci_run(event="workflow_dispatch", head_branch="main"),
        )
        self.assertEqual(plan["source_sha"], REVISION)
        self.assertEqual(plan["source_branch"], "main")
        self.assertEqual(plan["ci_run_id"], 123456)

    def test_rejects_non_release_ci_event_types(self) -> None:
        for event in ("pull_request", "merge_group", "schedule"):
            with self.subTest(event=event):
                with self.assertRaisesRegex(
                    release_deployment.ReleaseDeploymentError,
                    "push or workflow_dispatch",
                ):
                    build_plan(ci_run=ci_run(event=event))

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

    def test_auto_selects_services_enabled_for_the_environment(self) -> None:
        for environment, branch in (("dev", "develop"), ("staging", "main")):
            with self.subTest(environment=environment):
                plan = build_plan(
                    environment=environment,
                    services_csv="auto",
                    ci_run=ci_run(head_branch=branch),
                )
                self.assertEqual(
                    plan["services"],
                    ["backend", "frontend", "demucs"],
                )
                self.assertEqual(plan["services_csv"], "backend,frontend,demucs")

    def test_accepts_enabled_services_in_allowlist_order(self) -> None:
        plan = build_plan(
            environment="staging",
            services_csv="demucs, backend",
            ci_run=ci_run(head_branch="main"),
        )
        self.assertEqual(plan["services"], ["backend", "demucs"])
        self.assertEqual(plan["services_csv"], "backend,demucs")

    def test_rejects_service_disabled_for_environment(self) -> None:
        with self.assertRaisesRegex(
            release_deployment.ReleaseDeploymentError,
            r"stable-audio is disabled for environment 'staging'",
        ):
            build_plan(
                environment="staging",
                services_csv="backend,stable-audio",
                ci_run=ci_run(head_branch="main"),
            )

        with self.assertRaisesRegex(
            release_deployment.ReleaseDeploymentError,
            r"stable-audio is disabled for environment 'dev'",
        ):
            build_plan(services_csv="stable-audio")

    def test_rejects_auto_combined_with_named_services(self) -> None:
        for services in ("auto,backend", " AUTO , frontend "):
            with self.subTest(services=services):
                with self.assertRaisesRegex(
                    release_deployment.ReleaseDeploymentError,
                    "must not be combined with named services",
                ):
                    build_plan(services_csv=services)

    def test_rejects_unusable_environment_matrix(self) -> None:
        enabled = {"services": ["backend"]}
        cases = (
            ("not-json", "unable to read"),
            (
                json.dumps({"environments": {"dev": enabled}}),
                "schema_version",
            ),
            (
                json.dumps(
                    {
                        "schema_version": release_deployment.ENVIRONMENTS_SCHEMA_VERSION,
                        "environments": {"staging": enabled},
                    }
                ),
                "does not declare environment 'dev'",
            ),
            (
                json.dumps(
                    {
                        "schema_version": release_deployment.ENVIRONMENTS_SCHEMA_VERSION,
                        "environments": {"dev": {"services": "backend"}},
                    }
                ),
                "array of service names",
            ),
            (
                json.dumps(
                    {
                        "schema_version": release_deployment.ENVIRONMENTS_SCHEMA_VERSION,
                        "environments": {"dev": {"services": ["unknown"]}},
                    }
                ),
                "declares unsupported services",
            ),
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "release-environments.json"
            for content, message in cases:
                with self.subTest(message=message):
                    path.write_text(content, encoding="utf-8")
                    with self.assertRaisesRegex(
                        release_deployment.ReleaseDeploymentError,
                        message,
                    ):
                        build_plan(environments_path=path)

            missing = Path(directory) / "absent.json"
            with self.assertRaisesRegex(
                release_deployment.ReleaseDeploymentError,
                "unable to read release environment matrix",
            ):
                build_plan(environments_path=missing)

    def test_matrix_fixture_overrides_the_repository_matrix(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = write_matrix(
                directory,
                {
                    "schema_version": release_deployment.ENVIRONMENTS_SCHEMA_VERSION,
                    "environments": {"dev": {"services": ["backend", "stable-audio"]}},
                },
            )
            plan = build_plan(services_csv="auto", environments_path=path)
            self.assertEqual(plan["services"], ["backend", "stable-audio"])

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
