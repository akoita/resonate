from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1]
CONTROL_SPEC = importlib.util.spec_from_file_location(
    "release_controls",
    SCRIPTS / "release_controls.py",
)
assert CONTROL_SPEC and CONTROL_SPEC.loader
release_controls = importlib.util.module_from_spec(CONTROL_SPEC)
sys.modules[CONTROL_SPEC.name] = release_controls
CONTROL_SPEC.loader.exec_module(release_controls)


def valid_environment() -> dict[str, object]:
    return {
        "protection_rules": [
            {
                "type": "required_reviewers",
                "reviewers": [{"type": "User", "id": 123, "name": "release-maintainer"}],
            }
        ],
        "deployment_branch_policy": {
            "protected_branches": True,
            "custom_branch_policies": False,
        },
    }


def valid_ruleset(include_ref: str) -> dict[str, object]:
    return {
        "target": "tag",
        "enforcement": "active",
        "conditions": {"ref_name": {"include": [include_ref], "exclude": []}},
        "rules": [
            {"type": "creation"},
            {"type": "deletion"},
            {"type": "non_fast_forward"},
        ],
        "bypass_actors": [
            {"actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "always"}
        ],
    }


class ReleaseControlsTests(unittest.TestCase):
    def test_valid_controls_pass(self) -> None:
        release_controls.validate_controls(
            environment=valid_environment(),
            release_ruleset=valid_ruleset("refs/tags/v*"),
            milestone_ruleset=valid_ruleset("refs/tags/milestone-*"),
        )

    def test_environment_requires_reviewer_and_protected_branches(self) -> None:
        missing_reviewers = valid_environment()
        missing_reviewers["protection_rules"] = []
        with self.assertRaisesRegex(release_controls.ReleaseControlsError, "required_reviewers"):
            release_controls.validate_environment(missing_reviewers)

        empty_reviewers = valid_environment()
        empty_reviewers["protection_rules"][0]["reviewers"] = []
        with self.assertRaisesRegex(release_controls.ReleaseControlsError, "at least one reviewer"):
            release_controls.validate_environment(empty_reviewers)

        unprotected = valid_environment()
        unprotected["deployment_branch_policy"]["protected_branches"] = False
        with self.assertRaisesRegex(release_controls.ReleaseControlsError, "protected-branch"):
            release_controls.validate_environment(unprotected)

    def test_each_ruleset_has_exact_scope_and_protections(self) -> None:
        cases = (
            ("enforcement", "must be active"),
            ("target", "must be active"),
            ("conditions", "must include"),
            ("rules", "must contain"),
            ("bypass_actors", "always-enabled bypass actor"),
        )
        for field, message in cases:
            with self.subTest(field=field):
                ruleset = valid_ruleset("refs/tags/v*")
                if field == "enforcement":
                    ruleset[field] = "disabled"
                elif field == "target":
                    ruleset[field] = "branch"
                elif field == "conditions":
                    ruleset[field] = {"ref_name": {"include": ["refs/tags/other-*"], "exclude": []}}
                elif field == "rules":
                    ruleset[field] = {"type": "creation"}
                else:
                    ruleset[field] = [
                        {"actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "pull_request"}
                    ]
                with self.assertRaisesRegex(release_controls.ReleaseControlsError, message):
                    release_controls.validate_tag_ruleset(
                        ruleset,
                        name="release",
                        include_ref="refs/tags/v*",
                    )

        anonymous_bypass = valid_ruleset("refs/tags/v*")
        anonymous_bypass["bypass_actors"] = [{"bypass_mode": "always"}]
        with self.assertRaisesRegex(release_controls.ReleaseControlsError, "always-enabled bypass actor"):
            release_controls.validate_tag_ruleset(
                anonymous_bypass,
                name="release",
                include_ref="refs/tags/v*",
            )

    def test_milestone_ruleset_requires_milestone_pattern(self) -> None:
        with self.assertRaisesRegex(release_controls.ReleaseControlsError, "milestone tag ruleset"):
            release_controls.validate_controls(
                environment=valid_environment(),
                release_ruleset=valid_ruleset("refs/tags/v*"),
                milestone_ruleset=valid_ruleset("refs/tags/v*"),
            )

    def test_ruleset_id_is_positive_numeric_without_logging_value(self) -> None:
        for value in ("1", "987654"):
            self.assertEqual(
                release_controls.validate_ruleset_id(value, name="RELEASE_TAG_RULESET_ID"),
                value,
            )
        for value in ("", "0", "-1", "1.5", "abc"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(release_controls.ReleaseControlsError, "positive numeric"):
                    release_controls.validate_ruleset_id(value, name="RELEASE_TAG_RULESET_ID")

    def test_cli_fails_closed_for_invalid_json_and_succeeds_for_valid_controls(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment_path = root / "environment.json"
            release_path = root / "release.json"
            milestone_path = root / "milestone.json"
            environment_path.write_text(json.dumps(valid_environment()), encoding="utf-8")
            release_path.write_text(json.dumps(valid_ruleset("refs/tags/v*")), encoding="utf-8")
            milestone_path.write_text(json.dumps(valid_ruleset("refs/tags/milestone-*")), encoding="utf-8")
            command = [
                sys.executable,
                str(SCRIPTS / "release_controls.py"),
                "validate",
                "--environment",
                str(environment_path),
                "--release-ruleset",
                str(release_path),
                "--milestone-ruleset",
                str(milestone_path),
            ]
            valid = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(valid.returncode, 0, valid.stderr)

            release_path.write_text("{}", encoding="utf-8")
            invalid = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(invalid.returncode, 1)
            self.assertIn("release tag ruleset", invalid.stderr)


if __name__ == "__main__":
    unittest.main()
