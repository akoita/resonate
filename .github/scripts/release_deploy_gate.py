#!/usr/bin/env python3
"""Evaluate the fail-closed automatic deployment path for a published release.

The desktop workflow runs this validator after it changes the protected draft
release to published.  The deploy-handoff workflow runs it again before it
uses the retained image-run manifest.  Keeping the checks in a dependency-free
module makes the two boundaries use the same release contract.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence


RELEASE_EVIDENCE_SCHEMA = "resonate-release-evidence/v2"
SOURCE_SHA = re.compile(r"[0-9a-f]{40}")
POSITIVE_RUN_ID = re.compile(r"[1-9][0-9]*")
STABLE_RELEASE_TAG = re.compile(
    r"^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$"
)


class ReleaseDeployGateError(ValueError):
    """Raised when release gate input is malformed or cannot be read."""


@dataclass(frozen=True)
class GateDecision:
    """Stable output for the desktop and deploy-handoff workflow boundaries."""

    eligible: bool
    release_tag: str
    source_sha: str
    image_run_id: str
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _read_json(path: Path, *, description: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ReleaseDeployGateError(f"unable to read {description}: {error}") from error


def _value(document: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in document:
            return document[key]
    return None


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _run_id(value: Any) -> str:
    if isinstance(value, bool):
        return ""
    if isinstance(value, int):
        value = str(value)
    if not isinstance(value, str) or not POSITIVE_RUN_ID.fullmatch(value):
        return ""
    return value


def _bool_field(document: Mapping[str, Any], *keys: str) -> bool | None:
    value = _value(document, *keys)
    return value if isinstance(value, bool) else None


def _append_failure(failures: list[str], condition: bool, reason: str) -> None:
    if condition:
        failures.append(reason)


def evaluate_published_release(
    *,
    event_name: Any,
    event_ref: Any,
    event_ref_name: Any,
    release_tag: Any,
    release: Any,
    tag_ref: Any,
    release_evidence: Any,
    expected_source_sha: Any = None,
    expected_image_run_id: Any = None,
) -> GateDecision:
    """Return whether a published release may enter automatic staging.

    A false decision is the safe result for every release-shape mismatch.
    The function deliberately does not infer values from a different source:
    the release tag, Git ref, evidence asset, and Actions run must all agree.
    """

    requested_tag = _text(release_tag)
    release_document = release if isinstance(release, Mapping) else {}
    tag_document = tag_ref if isinstance(tag_ref, Mapping) else {}
    evidence_document = release_evidence if isinstance(release_evidence, Mapping) else {}

    tag_object = tag_document.get("object")
    tag_object = tag_object if isinstance(tag_object, Mapping) else {}
    source_sha = _text(tag_object.get("sha"))

    evidence_source_sha = _text(evidence_document.get("source_sha"))
    if not source_sha and SOURCE_SHA.fullmatch(evidence_source_sha or ""):
        source_sha = evidence_source_sha
    deployment_document = evidence_document.get("deployment")
    deployment_document = (
        deployment_document if isinstance(deployment_document, Mapping) else {}
    )
    image_run_document = evidence_document.get("image_run")
    image_run_document = image_run_document if isinstance(image_run_document, Mapping) else {}
    image_run_id = _run_id(image_run_document.get("id"))

    failures: list[str] = []
    _append_failure(
        failures,
        event_name != "push",
        "automatic handoff requires a tag-push context",
    )
    _append_failure(
        failures,
        not STABLE_RELEASE_TAG.fullmatch(requested_tag),
        "release tag must be a stable vMAJOR.MINOR.PATCH tag",
    )
    _append_failure(
        failures,
        _text(event_ref) != f"refs/tags/{requested_tag}",
        "tag-push ref does not match the release tag",
    )
    _append_failure(
        failures,
        _text(event_ref_name) != requested_tag,
        "tag-push ref name does not match the release tag",
    )

    release_document_tag = _text(_value(release_document, "tagName", "tag_name"))
    _append_failure(
        failures,
        release_document_tag != requested_tag,
        "published release tag does not match the requested tag",
    )
    _append_failure(
        failures,
        _bool_field(release_document, "isDraft", "is_draft") is not False,
        "published release must be non-draft",
    )
    _append_failure(
        failures,
        _bool_field(release_document, "isPrerelease", "is_prerelease") is not False,
        "published release must not be a prerelease",
    )

    tag_ref_name = _text(tag_document.get("ref"))
    _append_failure(
        failures,
        tag_ref_name != f"refs/tags/{requested_tag}",
        "Git tag ref does not match the release tag",
    )
    _append_failure(
        failures,
        _text(tag_object.get("type")) != "commit",
        "Git tag ref must resolve directly to a commit",
    )
    _append_failure(
        failures,
        not SOURCE_SHA.fullmatch(source_sha),
        "Git tag ref must contain a full lowercase source SHA",
    )

    target_commit = _value(release_document, "targetCommitish", "target_commitish")
    _append_failure(
        failures,
        not isinstance(target_commit, str) or target_commit != source_sha,
        "published release target must match the Git tag source SHA",
    )
    _append_failure(
        failures,
        not SOURCE_SHA.fullmatch(evidence_source_sha)
        or evidence_source_sha != source_sha,
        "release evidence source SHA does not match the Git tag",
    )
    _append_failure(
        failures,
        _text(evidence_document.get("schema_version")) != RELEASE_EVIDENCE_SCHEMA,
        "release evidence schema is not supported",
    )
    _append_failure(
        failures,
        _text(evidence_document.get("tag")) != requested_tag,
        "release evidence tag does not match the published release",
    )
    _append_failure(
        failures,
        _text(deployment_document.get("trigger_branch")) != "main",
        "release evidence manifest must identify the main branch",
    )
    _append_failure(
        failures,
        _text(deployment_document.get("environment")) != "staging",
        "release evidence manifest must identify the staging environment",
    )
    _append_failure(
        failures,
        not image_run_id,
        "release evidence must contain a positive image run ID",
    )

    if expected_source_sha is not None:
        expected_source = _text(expected_source_sha)
        _append_failure(
            failures,
            not SOURCE_SHA.fullmatch(expected_source) or expected_source != source_sha,
            "caller source SHA does not match the published release",
        )
    if expected_image_run_id is not None:
        expected_image = _run_id(expected_image_run_id)
        _append_failure(
            failures,
            not expected_image or expected_image != image_run_id,
            "caller image run ID does not match release evidence",
        )

    return GateDecision(
        eligible=not failures,
        release_tag=requested_tag,
        source_sha=source_sha if SOURCE_SHA.fullmatch(source_sha) else "",
        image_run_id=image_run_id,
        reason="eligible" if not failures else "; ".join(failures),
    )


def _safe_output(value: str) -> str:
    """Keep values written to GITHUB_OUTPUT single-line and non-ambiguous."""
    return value.replace("\r", " ").replace("\n", " ").strip()


def append_github_output(path: Path, decision: GateDecision) -> None:
    outputs = {
        "release_tag": decision.release_tag,
        "source_sha": decision.source_sha,
        "image_run_id": decision.image_run_id,
        "automatic_handoff_eligible": "true" if decision.eligible else "false",
        "eligibility_reason": decision.reason,
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            for key, value in outputs.items():
                handle.write(f"{key}={_safe_output(value)}\n")
    except (OSError, UnicodeError) as error:
        raise ReleaseDeployGateError(f"unable to write GitHub outputs: {error}") from error


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-json", required=True, type=Path)
    parser.add_argument("--tag-ref-json", required=True, type=Path)
    parser.add_argument("--release-evidence", required=True, type=Path)
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--event-name", required=True)
    parser.add_argument("--event-ref", required=True)
    parser.add_argument("--event-ref-name", required=True)
    parser.add_argument("--expected-source-sha")
    parser.add_argument("--expected-image-run-id")
    parser.add_argument("--github-output", type=Path)
    parser.add_argument(
        "--require-eligible",
        action="store_true",
        help="fail the command if the release is not eligible",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        decision = evaluate_published_release(
            event_name=args.event_name,
            event_ref=args.event_ref,
            event_ref_name=args.event_ref_name,
            release_tag=args.release_tag,
            release=_read_json(args.release_json, description="published release JSON"),
            tag_ref=_read_json(args.tag_ref_json, description="Git tag ref JSON"),
            release_evidence=_read_json(
                args.release_evidence,
                description="release evidence JSON",
            ),
            expected_source_sha=args.expected_source_sha,
            expected_image_run_id=args.expected_image_run_id,
        )
        if args.github_output is not None:
            append_github_output(args.github_output, decision)
        print(json.dumps(decision.as_dict(), sort_keys=True))
        if args.require_eligible and not decision.eligible:
            print(f"release deployment gate failed: {decision.reason}", file=sys.stderr)
            return 1
    except ReleaseDeployGateError as error:
        print(f"release deployment gate failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
