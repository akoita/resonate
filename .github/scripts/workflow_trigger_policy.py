#!/usr/bin/env python3
"""Enforce trigger and privilege boundaries for release workflows.

This checker intentionally uses only the Python standard library.  The
repository's workflow policy is small and structural, so a narrow YAML
scanner is preferable to silently depending on a third-party parser in a
runner or local checkout.  It reads top-level workflow/event/job structure and
does not execute workflow expressions or shell commands.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterable, Sequence


class WorkflowTriggerPolicyError(ValueError):
    """Raised when a workflow violates the release trigger policy."""


EXPECTED_WORKFLOWS = {
    "release-deployment.yml": ("workflow_dispatch",),
    "publish-deployable-images.yml": ("workflow_call",),
    "deploy-handoff.yml": ("workflow_call", "workflow_dispatch"),
    "publish-analytics-dataflow-flex-template.yml": ("workflow_dispatch",),
    "software-release.yml": ("workflow_dispatch",),
}


_TOP_LEVEL_KEY = re.compile(
    r"^(?P<indent>[ \t]*)(?P<key>(?:'[^']+'|\"[^\"]+\"|[A-Za-z0-9_.-]+))\s*:(?P<value>.*)$"
)
_KEY_VALUE = re.compile(
    r"^(?P<indent>[ \t]+)(?P<key>[A-Za-z0-9_.-]+)\s*:\s*(?P<value>.*)$"
)
def _strip_comment(line: str) -> str:
    """Remove a YAML comment outside a quoted scalar."""
    quote: str | None = None
    escaped = False
    for index, character in enumerate(line):
        if escaped:
            escaped = False
            continue
        if character == "\\" and quote == '"':
            escaped = True
            continue
        if character in ("'", '"'):
            if quote is None:
                quote = character
            elif quote == character:
                quote = None
            continue
        if character == "#" and quote is None and (index == 0 or line[index - 1].isspace()):
            return line[:index].rstrip()
    return line.rstrip()


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" \t"))


def _top_level_sections(text: str) -> dict[str, tuple[int, int, str]]:
    """Return top-level key ranges as ``key -> (start, end, inline value)``."""
    lines = text.splitlines()
    starts: list[tuple[str, int, str]] = []
    for index, raw_line in enumerate(lines):
        line = _strip_comment(raw_line)
        if not line.strip() or _indent(line) != 0:
            continue
        match = _TOP_LEVEL_KEY.fullmatch(line)
        if match is None:
            continue
        starts.append((_unquote(match.group("key")), index, match.group("value").strip()))

    sections: dict[str, tuple[int, int, str]] = {}
    for position, (key, start, value) in enumerate(starts):
        end = starts[position + 1][1] if position + 1 < len(starts) else len(lines)
        sections[key] = (start, end, value)
    return sections


def _flow_items(value: str) -> list[str]:
    """Parse the simple scalar/list forms used for workflow event values."""
    value = _strip_comment(value).strip()
    if not value:
        return []
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
        items = [item.strip() for item in value.split(",")]
    elif value.startswith("{") and value.endswith("}"):
        # Workflow trigger maps are commonly written as
        # ``on: {workflow_dispatch: {}}``.  Only the mapping keys are events;
        # nested values are irrelevant to this policy.
        value = value[1:-1]
        items = []
        for item in value.split(","):
            key, separator, _ = item.partition(":")
            if separator and key.strip():
                items.append(key.strip())
    else:
        items = [value]
    return [_unquote(item) for item in items if item.strip()]


def _direct_mapping_keys(lines: Iterable[str]) -> list[str]:
    """Extract keys at the minimum non-empty indentation in a block."""
    cleaned = [_strip_comment(line) for line in lines]
    nonempty = [line for line in cleaned if line.strip()]
    if not nonempty:
        return []
    minimum_indent = min(_indent(line) for line in nonempty)
    keys: list[str] = []
    for line in nonempty:
        if _indent(line) != minimum_indent:
            continue
        match = _KEY_VALUE.fullmatch(line)
        if match:
            keys.append(match.group("key"))
    return keys


def _trigger_events(text: str, *, path: Path) -> tuple[list[str], list[str]]:
    sections = _top_level_sections(text)
    on_section = sections.get("on")
    if on_section is None:
        raise WorkflowTriggerPolicyError(f"{path.name}: missing top-level 'on' trigger block")

    start, end, inline = on_section
    if inline:
        events = _flow_items(inline)
    else:
        lines = text.splitlines()[start + 1 : end]
        events = _direct_mapping_keys(lines)
    if not events:
        raise WorkflowTriggerPolicyError(f"{path.name}: trigger block must declare an event")
    return events, text.splitlines()[start + 1 : end]


def _validate_trigger_set(
    *,
    path: Path,
    expected_events: Sequence[str],
    events: Sequence[str],
) -> None:
    expected = set(expected_events)
    actual = set(events)
    if len(events) != len(actual):
        raise WorkflowTriggerPolicyError(
            f"{path.name}: trigger events must not contain duplicates"
        )
    if actual != expected:
        expected_text = ", ".join(expected_events)
        actual_text = ", ".join(events)
        raise WorkflowTriggerPolicyError(
            f"{path.name}: trigger events must be exactly [{expected_text}], "
            f"found [{actual_text}]"
        )


def validate_workflow_text(path: Path, text: str) -> None:
    """Validate a single policy-controlled workflow's trigger boundary."""
    expected_events = EXPECTED_WORKFLOWS.get(path.name)
    if expected_events is None:
        raise WorkflowTriggerPolicyError(
            f"{path.name}: no release trigger policy is defined for this workflow"
        )

    events, _trigger_lines = _trigger_events(text, path=path)
    _validate_trigger_set(path=path, expected_events=expected_events, events=events)


def _workflow_job_blocks(text: str, *, path: Path) -> list[tuple[str, str]]:
    """Return ``(job_id, block_text)`` pairs from the top-level jobs map."""
    sections = _top_level_sections(text)
    jobs_section = sections.get("jobs")
    if jobs_section is None:
        raise WorkflowTriggerPolicyError(f"{path.name}: missing top-level jobs block")

    lines = text.splitlines()
    start, end, _ = jobs_section
    candidates: list[tuple[str, int]] = []
    for index in range(start + 1, end):
        line = _strip_comment(lines[index])
        if _indent(line) != 2:
            continue
        match = _KEY_VALUE.fullmatch(line)
        if match:
            candidates.append((match.group("key"), index))

    blocks: list[tuple[str, str]] = []
    for position, (job_id, job_start) in enumerate(candidates):
        job_end = candidates[position + 1][1] if position + 1 < len(candidates) else end
        blocks.append((job_id, "\n".join(lines[job_start:job_end])))
    return blocks


_PROHIBITED_JOB_ID = re.compile(
    r"^(?:publish|deploy)(?:[-_].*)?$|"
    r"(?:^|[-_])publish[-_]?(?:plan|image|backend[-_]?image|frontend[-_]?image|"
    r"demucs[-_]?image|stable[-_]?image|deploy|manifest|handoff)(?:[-_]|$)|"
    r"(?:^|[-_])deploy[-_]?(?:image|manifest|handoff)(?:[-_]|$)",
    re.IGNORECASE,
)
_PROHIBITED_JOB_NAME = re.compile(
    r"\b(?:publish|deploy|deployment)\s+(?:the\s+)?(?:backend|frontend|demucs|stable|"
    r"image|images|application|service|deployment|manifest|handoff|production|staging|dev)\b",
    re.IGNORECASE,
)
_PROHIBITED_STEP = re.compile(
    r"(?:docker\s+(?:push\b|build(?:x)?\b[^\n]*--push)|"
    r"gcloud\s+(?:builds\s+submit|artifacts\s+docker)\b|"
    r"submit-cloud-build\b|publish-image-evidence\b|deploy-manifest\b|"
    r"resonate-iac\b|repository_dispatch\b)",
    re.IGNORECASE,
)
_ID_TOKEN_WRITE = re.compile(r"^\s*id-token\s*:\s*write\s*(?:#.*)?$", re.IGNORECASE)


def validate_ci_workflow(path: Path, text: str) -> None:
    """Ensure CI remains validation-only and cannot mint cloud credentials."""
    if path.name != "ci.yml":
        raise WorkflowTriggerPolicyError(f"{path.name}: expected the CI workflow filename ci.yml")
    for line in text.splitlines():
        if _ID_TOKEN_WRITE.fullmatch(line):
            raise WorkflowTriggerPolicyError(
                "ci.yml: validation-only CI must not grant id-token: write"
            )

    for job_id, block in _workflow_job_blocks(text, path=path):
        job_name = job_id
        for line in block.splitlines()[1:]:
            match = _KEY_VALUE.fullmatch(_strip_comment(line))
            if match and match.group("key") == "name":
                job_name = _unquote(match.group("value"))
                break

        if _PROHIBITED_JOB_ID.search(job_id) or _PROHIBITED_JOB_NAME.search(job_name):
            raise WorkflowTriggerPolicyError(
                f"ci.yml: job '{job_id}' appears to publish images or deploy"
            )
        if any(_PROHIBITED_STEP.search(_strip_comment(line)) for line in block.splitlines()):
            raise WorkflowTriggerPolicyError(
                f"ci.yml: job '{job_id}' contains an image-publishing or deployment operation"
            )


def _resolve_workflow_path(workflows_dir: Path, filename: str) -> Path:
    path = workflows_dir / filename
    if path.exists():
        return path
    yaml_path = path.with_suffix(".yaml")
    if yaml_path.exists():
        return yaml_path
    return path


def validate_repository(workflows_dir: Path) -> None:
    """Validate all release-trigger policies in a workflows directory."""
    if not workflows_dir.is_dir():
        raise WorkflowTriggerPolicyError(
            f"workflow directory does not exist: {workflows_dir}"
        )

    for filename, expected_events in EXPECTED_WORKFLOWS.items():
        path = _resolve_workflow_path(workflows_dir, filename)
        if not path.is_file():
            raise WorkflowTriggerPolicyError(
                f"missing policy-controlled workflow: {filename} "
                f"(expected trigger: {', '.join(expected_events)})"
            )
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            raise WorkflowTriggerPolicyError(
                f"unable to read {path.name}: {error}"
            ) from error
        validate_workflow_text(path, text)

    ci_path = _resolve_workflow_path(workflows_dir, "ci.yml")
    if not ci_path.is_file():
        raise WorkflowTriggerPolicyError("missing CI workflow: ci.yml")
    try:
        ci_text = ci_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise WorkflowTriggerPolicyError(f"unable to read ci.yml: {error}") from error
    validate_ci_workflow(ci_path, ci_text)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    # The security workflow invokes this checker directly, while local callers
    # may prefer the explicit ``validate`` subcommand.  Keep both forms
    # equivalent so a policy check cannot be skipped by a calling-convention
    # mismatch.
    if not raw_argv or raw_argv[0] != "validate":
        raw_argv.insert(0, "validate")

    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser(
        "validate",
        help="validate release workflow triggers and CI privilege boundaries",
    )
    validate.add_argument(
        "--workflows-dir",
        type=Path,
        default=Path(".github/workflows"),
        help="directory containing GitHub workflow YAML files",
    )
    return parser.parse_args(raw_argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        validate_repository(args.workflows_dir)
    except WorkflowTriggerPolicyError as error:
        print(f"workflow trigger policy validation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
