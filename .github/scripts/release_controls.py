#!/usr/bin/env python3
"""Validate the GitHub controls required for protected Resonate releases."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


POSITIVE_INTEGER = re.compile(r"[1-9][0-9]*")
REQUIRED_RULE_TYPES = frozenset(("creation", "deletion", "non_fast_forward"))


class ReleaseControlsError(ValueError):
    """Raised when a required GitHub release control is missing or malformed."""


def validate_ruleset_id(value: str, *, name: str) -> str:
    """Validate a GitHub ruleset ID without logging its value."""
    if not isinstance(value, str) or not POSITIVE_INTEGER.fullmatch(value):
        raise ReleaseControlsError(f"{name} must be a positive numeric ruleset ID")
    return value


def validate_environment(environment: Any) -> None:
    """Validate the protected software-release environment contract."""
    if not isinstance(environment, dict):
        raise ReleaseControlsError("software-release environment response must be a JSON object")

    protection_rules = environment.get("protection_rules")
    if not isinstance(protection_rules, list):
        raise ReleaseControlsError("software-release environment must declare protection_rules")

    reviewer_rules = [
        rule for rule in protection_rules
        if isinstance(rule, dict) and rule.get("type") == "required_reviewers"
    ]
    if not reviewer_rules:
        raise ReleaseControlsError(
            "software-release environment must have a required_reviewers protection rule"
        )
    if not any(
        isinstance(rule.get("reviewers"), list)
        and any(isinstance(reviewer, dict) and reviewer for reviewer in rule["reviewers"])
        for rule in reviewer_rules
    ):
        raise ReleaseControlsError(
            "software-release environment required_reviewers rule must include at least one reviewer"
        )

    deployment_branch_policy = environment.get("deployment_branch_policy")
    if not isinstance(deployment_branch_policy, dict) or deployment_branch_policy.get("protected_branches") is not True:
        raise ReleaseControlsError(
            "software-release environment must require the protected-branch deployment policy"
        )


def validate_tag_ruleset(ruleset: Any, *, name: str, include_ref: str) -> None:
    """Validate one active tag ruleset and its configured publisher bypass."""
    label = f"{name} tag ruleset"
    if not isinstance(ruleset, dict):
        raise ReleaseControlsError(f"{label} response must be a JSON object")
    if ruleset.get("enforcement") != "active" or ruleset.get("target") != "tag":
        raise ReleaseControlsError(f"{label} must be active and target tags")

    conditions = ruleset.get("conditions")
    ref_name = conditions.get("ref_name") if isinstance(conditions, dict) else None
    includes = ref_name.get("include") if isinstance(ref_name, dict) else None
    if not isinstance(includes, list) or include_ref not in includes:
        raise ReleaseControlsError(f"{label} must include {include_ref}")

    rules = ruleset.get("rules")
    rule_types: set[str] = set()
    if isinstance(rules, list):
        rule_types = {
            rule["type"]
            for rule in rules
            if isinstance(rule, dict) and isinstance(rule.get("type"), str)
        }
    missing = sorted(REQUIRED_RULE_TYPES - rule_types)
    if missing:
        raise ReleaseControlsError(
            f"{label} must contain creation, deletion, and non-fast-forward protections; "
            f"missing {', '.join(missing)}"
        )

    bypass_actors = ruleset.get("bypass_actors")
    if not isinstance(bypass_actors, list) or not any(
        isinstance(actor, dict)
        and actor.get("bypass_mode") == "always"
        and isinstance(actor.get("actor_type"), str)
        and bool(actor["actor_type"])
        and actor.get("actor_id") is not None
        for actor in bypass_actors
    ):
        raise ReleaseControlsError(
            f"{label} must have at least one always-enabled bypass actor"
        )


def validate_controls(
    *,
    environment: Any,
    release_ruleset: Any,
    milestone_ruleset: Any,
) -> None:
    """Validate all controls needed before the protected publisher runs."""
    validate_environment(environment)
    validate_tag_ruleset(
        release_ruleset,
        name="release",
        include_ref="refs/tags/v*",
    )
    validate_tag_ruleset(
        milestone_ruleset,
        name="milestone",
        include_ref="refs/tags/milestone-*",
    )


def _load_json(path: Path, *, description: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ReleaseControlsError(f"unable to read {description}: {error}") from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate", help="validate protected release controls")
    validate.add_argument("--environment", required=True, type=Path)
    validate.add_argument("--release-ruleset", required=True, type=Path)
    validate.add_argument("--milestone-ruleset", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_controls(
            environment=_load_json(args.environment, description="software-release environment"),
            release_ruleset=_load_json(args.release_ruleset, description="release tag ruleset"),
            milestone_ruleset=_load_json(args.milestone_ruleset, description="milestone tag ruleset"),
        )
    except ReleaseControlsError as error:
        print(f"protected release controls validation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
