#!/usr/bin/env python3
"""Validate an explicit Resonate release deployment plan.

The release workflow receives most of its values as strings, while the
referenced GitHub Actions run is read from the JSON returned by the Actions
API.  This module keeps the validation and normalization deterministic so that
preview output and publish input use the same contract.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence


SCHEMA_VERSION = "resonate-release-deployment-plan/v1"
SERVICES = ("backend", "frontend", "demucs", "stable-audio")
SOURCE_SHA = re.compile(r"[0-9a-f]{40}")
POSITIVE_INTEGER = re.compile(r"[1-9][0-9]*")
SAFE_RELEASE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
BRANCH_ENVIRONMENTS = {"develop": "dev", "main": "staging"}
MODES = ("preview", "publish")
RELEASE_KINDS = ("planned", "on-demand")


class ReleaseDeploymentError(ValueError):
    """Raised when release inputs or the referenced CI run are invalid."""


def validate_source_sha(value: Any) -> str:
    """Validate and return a full lowercase source commit SHA."""
    if not isinstance(value, str) or not SOURCE_SHA.fullmatch(value):
        raise ReleaseDeploymentError(
            "source_sha must be a full 40-character lowercase hexadecimal commit SHA"
        )
    return value


def parse_services(value: Any) -> list[str]:
    """Normalize a comma-separated service selection to allowlist order.

    Whitespace surrounding a service name is accepted, but every comma
    position must contain a service.  This deliberately rejects an empty
    selection and trailing or repeated commas.
    """
    if not isinstance(value, str):
        raise ReleaseDeploymentError("services must be a comma-separated string")

    raw_services = value.split(",")
    if not raw_services or any(not item.strip() for item in raw_services):
        raise ReleaseDeploymentError(
            "services must contain one or more non-empty service names"
        )

    requested = [item.strip() for item in raw_services]
    duplicates = sorted({service for service in requested if requested.count(service) > 1})
    if duplicates:
        raise ReleaseDeploymentError(
            f"services must not contain duplicates: {', '.join(duplicates)}"
        )

    unknown = sorted(set(requested) - set(SERVICES))
    if unknown:
        raise ReleaseDeploymentError(
            f"unsupported services: {', '.join(unknown)}; "
            f"allowed services are {', '.join(SERVICES)}"
        )

    requested_set = set(requested)
    return [service for service in SERVICES if service in requested_set]


def validate_release_id(value: Any) -> str:
    """Validate a non-empty, shell- and workflow-safe audit identifier."""
    if not isinstance(value, str) or not SAFE_RELEASE_ID.fullmatch(value):
        raise ReleaseDeploymentError(
            "release_id must be a non-empty identifier of at most 128 characters "
            "using only letters, numbers, '.', '_' or '-'"
        )
    return value


def validate_mode(value: Any) -> str:
    if not isinstance(value, str) or value not in MODES:
        raise ReleaseDeploymentError(
            f"mode must be one of: {', '.join(MODES)}"
        )
    return value


def validate_release_kind(value: Any) -> str:
    if not isinstance(value, str) or value not in RELEASE_KINDS:
        raise ReleaseDeploymentError(
            f"release_kind must be one of: {', '.join(RELEASE_KINDS)}"
        )
    return value


def parse_bool(value: Any, *, field: str = "deploy") -> bool:
    """Parse a workflow boolean without accepting arbitrary truthy values."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized == "true":
            return True
        if normalized == "false":
            return False
    raise ReleaseDeploymentError(f"{field} must be true or false")


def _require_string(document: Mapping[str, Any], key: str) -> str:
    value = document.get(key)
    if not isinstance(value, str) or not value:
        raise ReleaseDeploymentError(f"CI run field '{key}' must be a non-empty string")
    return value


def _validate_run_id(value: Any) -> int:
    # GitHub's Actions API represents run IDs as JSON numbers.  Do not accept
    # bool (which is an int subclass) or a string that could be confused with
    # another workflow input.
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ReleaseDeploymentError("CI run id must be a positive numeric integer")
    return value


def validate_ci_run(
    ci_run: Any,
    *,
    source_sha: str,
    environment: str,
) -> dict[str, Any]:
    """Validate the Actions run that produced the source revision.

    Only the fields needed by the release contract are returned.  Ignoring
    unrelated API fields prevents timestamps, URLs, or future API additions
    from making a generated plan nondeterministic.
    """
    if not isinstance(ci_run, Mapping):
        raise ReleaseDeploymentError("CI run JSON must be a JSON object")

    validate_source_sha(source_sha)
    if environment not in BRANCH_ENVIRONMENTS.values():
        raise ReleaseDeploymentError(
            f"environment must be one of: {', '.join(BRANCH_ENVIRONMENTS.values())}"
        )

    if ci_run.get("name") != "CI":
        raise ReleaseDeploymentError("CI run workflow name must be 'CI'")
    if ci_run.get("status") != "completed":
        raise ReleaseDeploymentError("CI run status must be completed")
    if ci_run.get("conclusion") != "success":
        raise ReleaseDeploymentError("CI run conclusion must be success")
    if ci_run.get("event") != "push":
        raise ReleaseDeploymentError("CI run event must be push")

    run_id = _validate_run_id(ci_run.get("id"))
    head_sha = _require_string(ci_run, "head_sha")
    if head_sha != source_sha:
        raise ReleaseDeploymentError("CI run head_sha must equal source_sha")

    source_branch = _require_string(ci_run, "head_branch")
    expected_environment = BRANCH_ENVIRONMENTS.get(source_branch)
    if expected_environment is None:
        raise ReleaseDeploymentError(
            "CI run head_branch must be develop or main"
        )
    if expected_environment != environment:
        raise ReleaseDeploymentError(
            f"CI run branch '{source_branch}' maps to environment "
            f"'{expected_environment}', not '{environment}'"
        )

    return {
        "id": run_id,
        "name": "CI",
        "status": "completed",
        "conclusion": "success",
        "event": "push",
        "head_branch": source_branch,
        "head_sha": source_sha,
    }


def build_plan(
    *,
    mode: str,
    release_kind: str,
    source_sha: str,
    environment: str,
    services_csv: str,
    deploy: bool,
    release_id: str,
    ci_run: Mapping[str, Any],
) -> dict[str, Any]:
    """Build a normalized, deterministic release-deployment plan."""
    mode = validate_mode(mode)
    release_kind = validate_release_kind(release_kind)
    source_sha = validate_source_sha(source_sha)
    if environment not in BRANCH_ENVIRONMENTS.values():
        raise ReleaseDeploymentError(
            f"environment must be one of: {', '.join(BRANCH_ENVIRONMENTS.values())}"
        )
    services = parse_services(services_csv)
    deploy = parse_bool(deploy)
    release_id = validate_release_id(release_id)
    if deploy and mode != "publish":
        raise ReleaseDeploymentError("deploy=true is only allowed when mode=publish")

    normalized_run = validate_ci_run(
        ci_run,
        source_sha=source_sha,
        environment=environment,
    )
    source_branch = normalized_run["head_branch"]

    # A preview may validate and render the selected image plan, but it can
    # never request the external deployment handoff.  A publish without the
    # explicit deploy input remains a publication-only run.
    should_dispatch = mode == "publish" and deploy
    return {
        "schema_version": SCHEMA_VERSION,
        "mode": mode,
        "release_kind": release_kind,
        "release_id": release_id,
        "source_sha": source_sha,
        "source_branch": source_branch,
        "ci_run_id": normalized_run["id"],
        "environment": environment,
        "services": services,
        "services_csv": ",".join(services),
        "deploy": deploy,
        "should_dispatch": should_dispatch,
    }


def load_ci_run(path: Path) -> dict[str, Any]:
    """Load a referenced Actions run JSON document from ``path``."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ReleaseDeploymentError(
            f"unable to read CI run JSON: {error}"
        ) from error
    if not isinstance(document, dict):
        raise ReleaseDeploymentError("CI run JSON must be a JSON object")
    return document


def write_json(path: Path, document: Any) -> None:
    """Write stable, human-readable JSON with a trailing newline."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(document, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except (OSError, UnicodeError) as error:
        raise ReleaseDeploymentError(f"unable to write JSON output: {error}") from error


def write_plan(path: Path, plan: Mapping[str, Any]) -> None:
    """Write a validated plan using stable JSON serialization."""
    write_json(path, dict(plan))


GITHUB_OUTPUT_KEYS: Sequence[str] = (
    "schema_version",
    "mode",
    "release_kind",
    "release_id",
    "source_sha",
    "source_branch",
    "ci_run_id",
    "environment",
    "services",
    "services_csv",
    "deploy",
    "should_dispatch",
)


def _output_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ",".join(str(item) for item in value)
    return str(value)


def append_github_output(path: Path, plan: Mapping[str, Any]) -> None:
    """Append the scalar release plan fields to a GitHub Actions output file."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a+", encoding="utf-8") as handle:
            handle.seek(0, 2)
            if handle.tell():
                handle.seek(handle.tell() - 1)
                if handle.read(1) != "\n":
                    handle.write("\n")
            for key in GITHUB_OUTPUT_KEYS:
                if key not in plan:
                    raise ReleaseDeploymentError(
                        f"plan is missing required GitHub output key '{key}'"
                    )
                handle.write(f"{key}={_output_value(plan[key])}\n")
    except ReleaseDeploymentError:
        raise
    except (OSError, UnicodeError) as error:
        raise ReleaseDeploymentError(
            f"unable to append GitHub output: {error}"
        ) from error


# A descriptive alias makes the file-writing operation discoverable to callers
# that use "write" terminology for GitHub's special output file.
write_github_output = append_github_output


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate", help="validate a release deployment plan")
    validate.add_argument("--mode", required=True, choices=MODES)
    validate.add_argument("--release-kind", required=True, choices=RELEASE_KINDS)
    validate.add_argument("--source-sha", required=True)
    validate.add_argument("--environment", required=True, choices=tuple(BRANCH_ENVIRONMENTS.values()))
    validate.add_argument("--services", required=True)
    validate.add_argument(
        "--deploy",
        required=True,
        nargs="?",
        const="true",
        choices=("true", "false"),
        help="whether the successful publish should request deployment (true/false)",
    )
    validate.add_argument("--release-id", required=True)
    validate.add_argument("--ci-run-json", required=True, type=Path)
    validate.add_argument("--output", required=True, type=Path)
    validate.add_argument("--github-output", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        ci_run = load_ci_run(args.ci_run_json)
        plan = build_plan(
            mode=args.mode,
            release_kind=args.release_kind,
            source_sha=args.source_sha,
            environment=args.environment,
            services_csv=args.services,
            deploy=args.deploy,
            release_id=args.release_id,
            ci_run=ci_run,
        )
        write_plan(args.output, plan)
        if args.github_output is not None:
            append_github_output(args.github_output, plan)
    except ReleaseDeploymentError as error:
        print(f"release deployment validation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
