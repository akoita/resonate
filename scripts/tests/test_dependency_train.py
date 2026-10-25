from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("dependency_train", SCRIPTS / "dependency_train.py")
assert SPEC and SPEC.loader
dependency_train = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = dependency_train
SPEC.loader.exec_module(dependency_train)


def git(root: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *arguments],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def pull_request(
    *,
    number: int = 17,
    title: str = "Bump example from 1.2.3 to 1.2.4",
    labels: list[str] | None = None,
    head_repository: str = "akoita/resonate",
    head_ref: str = "dependabot/npm_and_yarn/example-1.2.4",
) -> dependency_train.PullRequest:
    raw = {
        "number": number,
        "title": title,
        "body": "",
        "html_url": f"https://github.com/akoita/resonate/pull/{number}",
        "state": "open",
        "user": {"login": "dependabot[bot]"},
        "base": {"ref": "main", "repo": {"full_name": "akoita/resonate"}},
        "head": {
            "ref": head_ref,
            "sha": "a" * 40,
            "repo": {"full_name": head_repository},
        },
        "draft": False,
        "labels": [{"name": label} for label in (labels or [])],
    }
    return dependency_train.parse_pull_requests([raw])[0]


class DependencyTrainTests(unittest.TestCase):
    def test_parse_paginated_pull_request_response(self) -> None:
        parsed = dependency_train.parse_pull_requests(
            [[
                {
                    "number": 1,
                    "title": "Bump package",
                    "state": "open",
                    "user": {"login": "dependabot[bot]"},
                    "base": {"ref": "main", "repo": {"full_name": "akoita/resonate"}},
                    "head": {
                        "ref": "dependabot/npm/package-2.0.0",
                        "sha": "b" * 40,
                        "repo": {"full_name": "akoita/resonate"},
                    },
                    "labels": [],
                }
            ]],
        )
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].head_sha, "b" * 40)
        self.assertEqual(parsed[0].author, "dependabot[bot]")

    def test_risk_policy_keeps_normal_lockfile_updates_eligible(self) -> None:
        pr = pull_request()
        self.assertEqual(
            dependency_train.risk_reasons(pr, ["package.json", "package-lock.json"]),
            (),
        )

    def test_risk_policy_marks_major_and_control_plane_changes(self) -> None:
        major = pull_request(title="Bump example from 1.2.3 to 2.0.0")
        reasons = dependency_train.risk_reasons(major, ["package.json"])
        self.assertIn("major or breaking dependency update", reasons)

        control_plane = pull_request(number=18)
        reasons = dependency_train.risk_reasons(
            control_plane,
            [".github/workflows/ci.yml", "Dockerfile", "package-lock.json"],
        )
        self.assertEqual(len(reasons), 1)
        self.assertIn(".github/workflows/ci.yml", reasons[0])
        self.assertIn("Dockerfile", reasons[0])

    def test_rendered_body_has_all_disposition_sections_and_escapes_titles(self) -> None:
        pr = pull_request(title="Bump `example` [safe]\nnext")
        item = dependency_train.TrainItem(pr, "included", "merged")
        body = dependency_train.render_train_section(
            base_sha="c" * 40,
            included=[item],
            skipped=[],
            conflicting=[],
            risky=[],
        )
        self.assertIn(dependency_train.TRAIN_MARKER_START, body)
        self.assertIn("### Included Dependabot PRs", body)
        self.assertIn("### Skipped Dependabot PRs", body)
        self.assertIn("### Conflicting Dependabot PRs", body)
        self.assertIn("### Risky Dependabot PRs", body)
        self.assertIn("Bump \\`example\\` \\[safe\\] next", body)
        self.assertNotIn("next\n", body.split("Bump", 1)[1].split("(", 1)[0])

    def test_managed_body_update_preserves_notes(self) -> None:
        old = (
            "Maintainer notes.\n\n"
            + dependency_train.TRAIN_MARKER_START
            + "\nold\n"
            + dependency_train.TRAIN_MARKER_END
            + "\n\nFollow-up.\n"
        )
        updated = dependency_train.update_managed_body(
            old,
            "<!-- dependency-train:begin -->\nnew\n<!-- dependency-train:end -->",
        )
        self.assertIn("Maintainer notes.", updated)
        self.assertIn("new", updated)
        self.assertNotIn("old", updated)
        self.assertIn("Follow-up.", updated)

    def test_source_set_fingerprint_is_order_independent_and_includes_disposition(self) -> None:
        included = dependency_train.TrainItem(pull_request(number=17), "included", "merged")
        risky = dependency_train.TrainItem(
            pull_request(number=18, head_ref="dependabot/npm/example-2.0.0"),
            "risky",
            "major or breaking dependency update",
        )
        first = dependency_train.source_set_fingerprint([included, risky])
        second = dependency_train.source_set_fingerprint([risky, included])
        self.assertEqual(first, second)
        changed_disposition = dependency_train.source_set_fingerprint(
            [
                dependency_train.TrainItem(included.pull_request, "skipped", "pending"),
                risky,
            ]
        )
        self.assertNotEqual(first, changed_disposition)
        body = dependency_train.render_train_section(
            base_sha="c" * 40,
            included=[included],
            skipped=[],
            conflicting=[],
            risky=[risky],
            source_fingerprint=first,
        )
        self.assertEqual(dependency_train.extract_source_set_fingerprint(body), first)

    def test_commit_checks_require_completed_non_failing_results(self) -> None:
        success = {"check_runs": [{"name": "baseline", "status": "completed", "conclusion": "success"}]}
        self.assertEqual(
            dependency_train.evaluate_commit_checks([success], {"statuses": []}).disposition,
            "ready",
        )
        pending = {"check_runs": [{"name": "baseline", "status": "in_progress", "conclusion": None}]}
        evaluation = dependency_train.evaluate_commit_checks([pending], {"statuses": []})
        self.assertEqual(evaluation.disposition, "pending")
        self.assertIn("baseline", evaluation.details[0])
        for conclusion in ("failure", "cancelled", "timed_out", "action_required"):
            with self.subTest(conclusion=conclusion):
                failed = {
                    "check_runs": [
                        {
                            "name": "baseline",
                            "status": "completed",
                            "conclusion": conclusion,
                        }
                    ]
                }
                evaluation = dependency_train.evaluate_commit_checks([failed], {"statuses": []})
                self.assertEqual(evaluation.disposition, "failed")
                self.assertIn(conclusion, evaluation.details[0])

    def test_commit_checks_query_both_check_runs_and_status_apis(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls: list[list[str]] = []
            original_gh = dependency_train._gh

            def fake_gh(
                _repository_root: Path,
                arguments: list[str],
                *,
                check: bool = True,
            ) -> dependency_train.CommandResult:
                del check
                calls.append(arguments)
                if any("/check-runs?" in argument for argument in arguments):
                    return dependency_train.CommandResult(
                        0,
                        json.dumps(
                            [
                                {
                                    "check_runs": [
                                        {
                                            "name": "baseline",
                                            "status": "completed",
                                            "conclusion": "success",
                                        }
                                    ]
                                }
                            ]
                        ),
                        "",
                    )
                if any(argument.endswith("/status") for argument in arguments):
                    return dependency_train.CommandResult(0, json.dumps({"statuses": []}), "")
                raise AssertionError(f"unexpected gh command: {arguments}")

            dependency_train._gh = fake_gh
            try:
                evaluation = dependency_train._commit_checks(root, "akoita/resonate", "d" * 40)
            finally:
                dependency_train._gh = original_gh
            self.assertEqual(evaluation.disposition, "ready")
            self.assertEqual(len(calls), 2)
            self.assertTrue(any("/commits/" + "d" * 40 + "/check-runs?" in argument for argument in calls[0]))
            self.assertTrue(any("/commits/" + "d" * 40 + "/status" in argument for argument in calls[1]))

    def test_zero_checks_are_pending_and_commit_statuses_are_checked(self) -> None:
        evaluation = dependency_train.evaluate_commit_checks([], {"statuses": []})
        self.assertEqual(evaluation.disposition, "pending")
        self.assertIn("no checks reported", evaluation.details[0])

        status_success = dependency_train.evaluate_commit_checks(
            [], {"statuses": [{"context": "baseline", "state": "success"}]}
        )
        self.assertEqual(status_success.disposition, "ready")
        status_failure = dependency_train.evaluate_commit_checks(
            [], {"statuses": [{"context": "baseline", "state": "error"}]}
        )
        self.assertEqual(status_failure.disposition, "failed")

    def test_conflicting_merge_is_aborted_and_leaves_train_clean(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            git(root, "init", "-b", "main")
            git(root, "config", "user.name", "Dependency Train Test")
            git(root, "config", "user.email", "dependency-train@example.test")
            (root / "shared.txt").write_text("base\n", encoding="utf-8")
            git(root, "add", "shared.txt")
            git(root, "commit", "-m", "base")
            base = git(root, "rev-parse", "HEAD")

            git(root, "switch", "-c", "train", base)
            (root / "shared.txt").write_text("train\n", encoding="utf-8")
            git(root, "commit", "-am", "train change")

            git(root, "switch", "-c", "source", base)
            (root / "shared.txt").write_text("source\n", encoding="utf-8")
            git(root, "commit", "-am", "source change")
            source = git(root, "rev-parse", "HEAD")
            git(root, "switch", "train")

            pr = pull_request()
            merged, reason = dependency_train._merge_pull_request(root, "source", pr)
            self.assertFalse(merged)
            self.assertEqual(reason, "merge conflict with another selected Dependabot update")
            self.assertEqual((root / "shared.txt").read_text(encoding="utf-8"), "train\n")
            self.assertEqual(git(root, "status", "--porcelain"), "")
            self.assertEqual(git(root, "rev-parse", "HEAD"), git(root, "rev-parse", "train"))
            self.assertEqual(len(source), 40)

    def test_rebuild_train_pushes_one_branch_from_current_main(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bare = root / "origin.git"
            work = root / "work"
            git(root, "init", "--bare", str(bare))
            git(root, "init", "-b", "main", str(work))
            git(work, "config", "user.name", "Dependency Train Test")
            git(work, "config", "user.email", "dependency-train@example.test")
            (work / "package-lock.json").write_text("base\n", encoding="utf-8")
            git(work, "add", "package-lock.json")
            git(work, "commit", "-m", "base")
            git(work, "remote", "add", "origin", str(bare))
            git(work, "push", "origin", "main")
            base = git(work, "rev-parse", "HEAD")

            git(work, "switch", "-c", "dependabot/npm/example-1.2.4")
            (work / "package-lock.json").write_text("dependency update\n", encoding="utf-8")
            git(work, "commit", "-am", "Bump example from 1.2.3 to 1.2.4")
            head = git(work, "rev-parse", "HEAD")
            git(work, "push", "origin", "HEAD:refs/heads/dependabot/npm/example-1.2.4")
            git(bare, "update-ref", "refs/pull/17/head", head)
            git(work, "switch", "main")

            raw_pr = {
                "number": 17,
                "title": "Bump example from 1.2.3 to 1.2.4",
                "html_url": "https://github.com/akoita/resonate/pull/17",
                "state": "open",
                "user": {"login": "dependabot[bot]"},
                "base": {"ref": "main", "repo": {"full_name": "akoita/resonate"}},
                "head": {
                    "ref": "dependabot/npm/example-1.2.4",
                    "sha": head,
                    "repo": {"full_name": "akoita/resonate"},
                },
                "draft": False,
                "labels": [],
            }
            original_gh = dependency_train._gh
            calls: list[list[str]] = []
            api_records: list[dict[str, object]] = [raw_pr]

            def fake_gh(
                _repository_root: Path,
                arguments: list[str],
                *,
                check: bool = True,
            ) -> dependency_train.CommandResult:
                del check
                calls.append(arguments)
                if any("/check-runs?" in argument for argument in arguments):
                    return dependency_train.CommandResult(
                        0,
                        json.dumps(
                            [
                                {
                                    "check_runs": [
                                        {
                                            "name": "source",
                                            "status": "completed",
                                            "conclusion": "success",
                                        }
                                    ]
                                }
                            ]
                        ),
                        "",
                    )
                if any(argument.endswith("/status") for argument in arguments):
                    return dependency_train.CommandResult(0, json.dumps({"statuses": []}), "")
                if arguments[0:2] == ["api", "--paginate"]:
                    return dependency_train.CommandResult(0, json.dumps([api_records]), "")
                if arguments[:2] == ["pr", "create"]:
                    return dependency_train.CommandResult(
                        0,
                        "https://github.com/akoita/resonate/pull/99\n",
                        "",
                    )
                raise AssertionError(f"unexpected gh command: {arguments}")

            dependency_train._gh = fake_gh
            try:
                result = dependency_train.rebuild_train(
                    repository_root=work,
                    repository="akoita/resonate",
                )
            except BaseException:
                dependency_train._gh = original_gh
                raise

            self.assertEqual(result.base_sha, base)
            self.assertEqual([item.pull_request.number for item in result.included], [17])
            self.assertEqual(result.train_pr_number, 99)
            self.assertEqual(
                git(work, "rev-parse", "refs/remotes/origin/automation/dependency-train"),
                git(work, "rev-parse", "automation/dependency-train"),
            )
            self.assertTrue(any(arguments[:2] == ["pr", "create"] for arguments in calls))

            train_sha = git(work, "rev-parse", "automation/dependency-train")
            train_body = dependency_train.render_train_section(
                base_sha=base,
                included=result.included,
                skipped=result.skipped,
                conflicting=result.conflicting,
                risky=result.risky,
                source_fingerprint=result.source_fingerprint,
            )
            api_records.append(
                {
                    "number": 99,
                    "title": dependency_train.TRAIN_TITLE,
                    "body": train_body,
                    "html_url": "https://github.com/akoita/resonate/pull/99",
                    "state": "open",
                    "user": {"login": "github-actions[bot]"},
                    "base": {"ref": "main", "repo": {"full_name": "akoita/resonate"}},
                    "head": {
                        "ref": dependency_train.DEFAULT_TRAIN_BRANCH,
                        "sha": train_sha,
                        "repo": {"full_name": "akoita/resonate"},
                    },
                    "draft": False,
                    "labels": [],
                }
            )
            git(work, "switch", "main")
            (work / "main-only.txt").write_text("main advanced\n", encoding="utf-8")
            git(work, "add", "main-only.txt")
            git(work, "commit", "-m", "main-only maintenance")
            git(work, "push", "origin", "main")
            advanced_base = git(work, "rev-parse", "HEAD")
            original_push = dependency_train._push_train_branch

            def fail_if_rewritten(*_arguments: object, **_keywords: object) -> None:
                raise AssertionError("unchanged source set must not push the train branch")

            dependency_train._push_train_branch = fail_if_rewritten
            calls_before_repeat = len(calls)
            try:
                repeated = dependency_train.rebuild_train(
                    repository_root=work,
                    repository="akoita/resonate",
                )
            finally:
                dependency_train._push_train_branch = original_push
                dependency_train._gh = original_gh
            self.assertEqual(repeated.base_sha, advanced_base)
            self.assertEqual(
                repeated.source_fingerprint,
                result.source_fingerprint,
                (
                    [(item.pull_request.number, item.category, item.reason) for item in repeated.included],
                    [(item.pull_request.number, item.category, item.reason) for item in repeated.skipped],
                    [(item.pull_request.number, item.category, item.reason) for item in repeated.risky],
                ),
            )
            self.assertEqual(repeated.train_pr_number, 99)
            self.assertEqual(repeated.train_pr_url, "https://github.com/akoita/resonate/pull/99")
            self.assertFalse(any(arguments[:2] == ["pr", "edit"] for arguments in calls[calls_before_repeat:]))
            self.assertFalse(any(arguments[:2] == ["pr", "create"] for arguments in calls[calls_before_repeat:]))

    def _init_repository(self, root: Path) -> Path:
        git(root, "init", "-b", "main")
        git(root, "config", "user.name", "Dependency Train Test")
        git(root, "config", "user.email", "dependency-train@example.test")
        return root

    def test_is_already_on_base_detects_squash_applied_updates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = self._init_repository(Path(directory))
            (root / "lock.txt").write_text("base\n", encoding="utf-8")
            (root / "other.txt").write_text("base\n", encoding="utf-8")
            git(root, "add", ".")
            git(root, "commit", "-m", "base")
            base = git(root, "rev-parse", "HEAD")

            git(root, "switch", "-c", "applied", base)
            (root / "lock.txt").write_text("update\n", encoding="utf-8")
            git(root, "commit", "-am", "applied update")
            git(root, "switch", "-c", "pending", base)
            (root / "other.txt").write_text("pending update\n", encoding="utf-8")
            git(root, "commit", "-am", "pending update")
            git(root, "switch", "-c", "conflicting", base)
            (root / "lock.txt").write_text("different update\n", encoding="utf-8")
            git(root, "commit", "-am", "conflicting update")

            # Squash-style: main gets a separate commit with identical content.
            git(root, "switch", "main")
            (root / "lock.txt").write_text("update\n", encoding="utf-8")
            git(root, "commit", "-am", "squash of the applied update")
            main_sha = git(root, "rev-parse", "HEAD")

            self.assertTrue(dependency_train._is_already_on_base(root, main_sha, "applied"))
            self.assertFalse(dependency_train._is_already_on_base(root, main_sha, "pending"))
            self.assertFalse(dependency_train._is_already_on_base(root, main_sha, "conflicting"))
            self.assertEqual(git(root, "status", "--porcelain"), "")
            self.assertEqual(git(root, "rev-parse", "HEAD"), main_sha)
            self.assertEqual((root / "lock.txt").read_text(encoding="utf-8"), "update\n")

    def _superseded_fixture(self, root: Path) -> tuple[Path, str, dict[str, object], dict[str, object]]:
        """Create origin and a work clone with PR 17 already on main and PR 18 pending."""

        bare = root / "origin.git"
        work = root / "work"
        git(root, "init", "--bare", str(bare))
        git(root, "init", "-b", "main", str(work))
        git(work, "config", "user.name", "Dependency Train Test")
        git(work, "config", "user.email", "dependency-train@example.test")
        (work / "applied.txt").write_text("base\n", encoding="utf-8")
        (work / "pending.txt").write_text("base\n", encoding="utf-8")
        git(work, "add", ".")
        git(work, "commit", "-m", "base")
        git(work, "remote", "add", "origin", str(bare))
        git(work, "push", "origin", "main")
        base = git(work, "rev-parse", "HEAD")

        raws: list[dict[str, object]] = []
        for number, filename, content in (
            (17, "applied.txt", "applied update\n"),
            (18, "pending.txt", "pending update\n"),
        ):
            branch = f"dependabot/npm/example-{number}"
            git(work, "switch", "-c", branch, base)
            (work / filename).write_text(content, encoding="utf-8")
            git(work, "commit", "-am", f"Bump example {number}")
            head = git(work, "rev-parse", "HEAD")
            git(work, "push", "origin", f"HEAD:refs/heads/{branch}")
            git(bare, "update-ref", f"refs/pull/{number}/head", head)
            git(work, "switch", "main")
            raws.append(
                {
                    "number": number,
                    "title": f"Bump example {number}",
                    "html_url": f"https://github.com/akoita/resonate/pull/{number}",
                    "state": "open",
                    "user": {"login": "dependabot[bot]"},
                    "base": {"ref": "main", "repo": {"full_name": "akoita/resonate"}},
                    "head": {
                        "ref": branch,
                        "sha": head,
                        "repo": {"full_name": "akoita/resonate"},
                    },
                    "draft": False,
                    "labels": [],
                }
            )

        # A separate squash-style commit puts PR 17's change on main.
        (work / "applied.txt").write_text("applied update\n", encoding="utf-8")
        git(work, "commit", "-am", "chore(deps): consolidate Dependabot updates (#99)")
        git(work, "push", "origin", "main")
        return work, git(work, "rev-parse", "HEAD"), raws[0], raws[1]

    def _make_fake_gh(
        self,
        records: list[dict[str, object]],
        calls: list[list[str]],
        *,
        close_error: str | None = None,
        allow_checks: bool = True,
    ):
        def fake_gh(
            _repository_root: Path,
            arguments: list[str],
            *,
            check: bool = True,
        ) -> dependency_train.CommandResult:
            calls.append(list(arguments))
            if any("/check-runs?" in argument for argument in arguments):
                if not allow_checks:
                    raise AssertionError("close-only mode must not query checks")
                return dependency_train.CommandResult(
                    0,
                    json.dumps(
                        [{"check_runs": [{"name": "source", "status": "completed", "conclusion": "success"}]}]
                    ),
                    "",
                )
            if any(argument.endswith("/status") for argument in arguments):
                if not allow_checks:
                    raise AssertionError("close-only mode must not query checks")
                return dependency_train.CommandResult(0, json.dumps({"statuses": []}), "")
            if arguments[0:2] == ["api", "--paginate"]:
                return dependency_train.CommandResult(0, json.dumps([records]), "")
            if arguments[:2] == ["pr", "close"]:
                if close_error is not None:
                    if check:
                        raise dependency_train.DependencyTrainError(close_error)
                    return dependency_train.CommandResult(1, "", close_error)
                return dependency_train.CommandResult(0, "", "")
            if arguments[:2] == ["pr", "create"] and allow_checks:
                return dependency_train.CommandResult(
                    0, "https://github.com/akoita/resonate/pull/99\n", ""
                )
            raise AssertionError(f"unexpected gh command: {arguments}")

        return fake_gh

    def _patched_rebuild(self, fake_gh, **keywords):
        original_gh = dependency_train._gh
        dependency_train._gh = fake_gh
        try:
            return dependency_train.rebuild_train(
                repository_root=keywords.pop("work"),
                repository="akoita/resonate",
                **keywords,
            )
        finally:
            dependency_train._gh = original_gh

    @staticmethod
    def _close_calls(calls: list[list[str]]) -> list[list[str]]:
        return [arguments for arguments in calls if arguments[:2] == ["pr", "close"]]

    def test_rebuild_train_closes_sources_already_on_main(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work, base, raw_17, raw_18 = self._superseded_fixture(Path(directory))
            calls: list[list[str]] = []
            fake_gh = self._make_fake_gh([raw_17, raw_18], calls)

            result = self._patched_rebuild(fake_gh, work=work)

            closes = self._close_calls(calls)
            self.assertEqual(len(closes), 1)
            self.assertEqual(closes[0][:6], ["pr", "close", "17", "--repo", "akoita/resonate", "--comment"])
            self.assertIn("already on `main`", closes[0][6])
            self.assertEqual([item.pull_request.number for item in result.superseded], [17])
            self.assertEqual(result.superseded[0].category, "superseded")
            self.assertEqual(result.superseded[0].reason, "already on main")
            self.assertEqual([item.pull_request.number for item in result.included], [18])
            self.assertNotIn(17, [item.pull_request.number for item in result.skipped])
            body = dependency_train.render_train_section(
                base_sha=base,
                included=result.included,
                skipped=result.skipped,
                conflicting=result.conflicting,
                risky=result.risky,
                source_fingerprint=result.source_fingerprint,
            )
            self.assertNotIn("pull/17", body)
            self.assertIn("pull/18", body)
            self.assertEqual(
                result.source_fingerprint,
                dependency_train.source_set_fingerprint(result.included),
            )
            self.assertEqual(result.train_pr_number, 99)

    def test_rebuild_train_dry_run_reports_superseded_without_closing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work, _base, raw_17, raw_18 = self._superseded_fixture(Path(directory))
            calls: list[list[str]] = []
            fake_gh = self._make_fake_gh([raw_17, raw_18], calls)

            result = self._patched_rebuild(fake_gh, work=work, dry_run=True)

            self.assertEqual([item.pull_request.number for item in result.superseded], [17])
            self.assertEqual(self._close_calls(calls), [])
            self.assertFalse(any(arguments[:2] == ["pr", "create"] for arguments in calls))

    def test_close_superseded_only_never_builds_or_publishes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work, _base, raw_17, raw_18 = self._superseded_fixture(Path(directory))
            calls: list[list[str]] = []
            fake_gh = self._make_fake_gh([raw_17, raw_18], calls, allow_checks=False)
            original_push = dependency_train._push_train_branch

            def fail_if_pushed(*_arguments: object, **_keywords: object) -> None:
                raise AssertionError("close-only mode must not push the train branch")

            dependency_train._push_train_branch = fail_if_pushed
            try:
                result = self._patched_rebuild(fake_gh, work=work, close_superseded_only=True)
            finally:
                dependency_train._push_train_branch = original_push

            self.assertEqual(len(self._close_calls(calls)), 1)
            self.assertEqual(self._close_calls(calls)[0][2], "17")
            self.assertEqual([item.pull_request.number for item in result.superseded], [17])
            self.assertEqual(result.included, ())
            self.assertEqual(result.conflicting, ())
            self.assertEqual(result.skipped, ())
            self.assertEqual(result.risky, ())
            self.assertFalse(
                any(arguments[:2] in (["pr", "create"], ["pr", "edit"]) for arguments in calls)
            )
            self.assertEqual(git(work, "branch", "--list", "automation/dependency-train"), "")

    def test_failed_close_is_recorded_as_skipped_and_does_not_abort(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            work, _base, raw_17, raw_18 = self._superseded_fixture(Path(directory))
            calls: list[list[str]] = []
            fake_gh = self._make_fake_gh(
                [raw_17, raw_18],
                calls,
                close_error="command failed (gh pr…): HTTP 403",
            )

            result = self._patched_rebuild(fake_gh, work=work)

            self.assertEqual(len(self._close_calls(calls)), 1)
            self.assertEqual(result.superseded, ())
            skipped = {item.pull_request.number: item for item in result.skipped}
            self.assertIn(17, skipped)
            self.assertTrue(skipped[17].reason.startswith("unable to close superseded pull request:"))
            self.assertIn("HTTP 403", skipped[17].reason)
            self.assertEqual([item.pull_request.number for item in result.included], [18])

    def test_branch_and_repository_validation_rejects_option_injection(self) -> None:
        with self.assertRaises(dependency_train.DependencyTrainError):
            dependency_train._validate_options("main; touch /tmp/x", "automation/dependency-train")
        with self.assertRaises(dependency_train.DependencyTrainError):
            dependency_train._repository_owner("akoita/resonate?bad=true")
        with self.assertRaises(dependency_train.DependencyTrainError):
            dependency_train._validate_remote("--upload-pack=evil")


if __name__ == "__main__":
    unittest.main()
