#!/usr/bin/env python3
"""Rebuild a review-only pull request from safe Dependabot pull requests.

The command is intentionally small and uses only the Python standard library.
It fetches pull-request refs as objects, inspects their metadata and diff
names, and merges selected commits without checking out or executing source
from the pull-request branches.  The caller is responsible for authenticating
``gh`` and for granting the minimum permissions needed to push the train
branch and edit/create its pull request.

No source pull request is closed or merged by this script.  A conflict or a
review-risk is isolated to that pull request and is recorded in the generated
train description; other eligible pull requests can still be included.  Heads
without a completed, non-failing source check are skipped, and the final
number/SHA/disposition set is fingerprinted so a repeated run does not rewrite
an unchanged train branch.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import quote


DEPENDABOT_LOGIN = "dependabot[bot]"
DEFAULT_BASE_BRANCH = "main"
DEFAULT_TRAIN_BRANCH = "automation/dependency-train"
DEFAULT_MAX_PULL_REQUESTS = 100
TRAIN_MARKER_START = "<!-- dependency-train:begin -->"
TRAIN_MARKER_END = "<!-- dependency-train:end -->"
TRAIN_TITLE = "chore(deps): consolidate Dependabot updates"
SHA_PATTERN = re.compile(r"^[0-9a-fA-F]{40}$")
FINGERPRINT_PATTERN = re.compile(r"^- Source-set fingerprint: `([0-9a-f]{64})`$", re.MULTILINE)
BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9._/-]+$")
REMOTE_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
REPOSITORY_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

# The train is intended for ordinary dependency graph changes.  A dependency
# PR that changes delivery/control-plane code should remain an individually
# reviewable PR.  Lockfiles and manifests are deliberately not in this list.
RISKY_PATH_PREFIXES = (
    ".github/workflows/",
    ".github/actions/",
    ".github/scripts/",
    "contracts/",
    "infra/",
    "terraform/",
)
RISKY_PATH_NAMES = {
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "makefile",
}
RISKY_PATH_SUFFIXES = (".sh",)
RISKY_LABELS = {
    "breaking-change",
    "breaking",
    "major",
    "major-update",
    "major update",
}
CHECK_PENDING_STATUSES = {"queued", "in_progress", "pending", "requested", "waiting"}
CHECK_ALLOWED_CONCLUSIONS = {"success", "neutral", "skipped"}
STATUS_SUCCESS = "success"
STATUS_PENDING = "pending"
STATUS_FAILED = {"failure", "error"}


class DependencyTrainError(RuntimeError):
    """Raised when the train cannot be rebuilt safely."""


@dataclasses.dataclass(frozen=True)
class PullRequest:
    """The immutable metadata needed to process one pull request."""

    number: int
    title: str
    body: str
    url: str
    state: str
    author: str
    base_ref: str
    base_repository: str | None
    head_ref: str
    head_sha: str
    head_repository: str | None
    draft: bool
    labels: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class TrainItem:
    """A rendered disposition for a Dependabot pull request."""

    pull_request: PullRequest
    category: str
    reason: str = ""
    changed_files: tuple[str, ...] = ()


@dataclasses.dataclass(frozen=True)
class TrainResult:
    """Result of one rebuild, suitable for a step summary or test."""

    base_sha: str
    included: tuple[TrainItem, ...]
    skipped: tuple[TrainItem, ...]
    conflicting: tuple[TrainItem, ...]
    risky: tuple[TrainItem, ...]
    source_fingerprint: str
    train_pr_number: int | None = None
    train_pr_url: str | None = None


@dataclasses.dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


@dataclasses.dataclass(frozen=True)
class CheckEvaluation:
    """Disposition of all checks reported for one verified commit."""

    disposition: str
    details: tuple[str, ...] = ()


def _command_environment() -> dict[str, str]:
    """Return a non-interactive environment for git and gh subprocesses."""

    environment = os.environ.copy()
    environment.setdefault("GIT_TERMINAL_PROMPT", "0")
    environment.setdefault("GIT_LFS_SKIP_SMUDGE", "1")
    return environment


def run_command(
    arguments: Sequence[str],
    *,
    cwd: Path,
    check: bool = True,
) -> CommandResult:
    """Run a command without a shell and redact token-like output on failure."""

    completed = subprocess.run(
        list(arguments),
        cwd=cwd,
        env=_command_environment(),
        text=True,
        capture_output=True,
        check=False,
    )
    result = CommandResult(completed.returncode, completed.stdout, completed.stderr)
    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "no command output"
        for secret_name in ("GH_TOKEN", "GITHUB_TOKEN"):
            secret = os.environ.get(secret_name)
            if secret:
                detail = detail.replace(secret, "[REDACTED]")
        raise DependencyTrainError(
            f"command failed ({' '.join(arguments[:2])}…): {detail}"
        )
    return result


def _git(repository_root: Path, arguments: Sequence[str], *, check: bool = True) -> CommandResult:
    return run_command(["git", *arguments], cwd=repository_root, check=check)


def _gh(repository_root: Path, arguments: Sequence[str], *, check: bool = True) -> CommandResult:
    return run_command(["gh", *arguments], cwd=repository_root, check=check)


def _json_from_gh(repository_root: Path, arguments: Sequence[str]) -> Any:
    result = _gh(repository_root, arguments)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise DependencyTrainError(f"gh returned invalid JSON: {error}") from error


def _flatten_pages(payload: Any) -> list[Any]:
    """Flatten ``gh api --paginate --slurp`` output and reject bad shapes."""

    if not isinstance(payload, list):
        raise DependencyTrainError("gh API response was not a JSON array")
    if payload and all(isinstance(page, list) for page in payload):
        return [item for page in payload for item in page]
    return payload


def _check_run_records(payload: Any) -> list[Mapping[str, Any]]:
    """Extract check-run objects from paginated REST responses."""

    records: list[Mapping[str, Any]] = []
    for page in _flatten_pages(payload):
        if not isinstance(page, Mapping):
            raise DependencyTrainError("gh returned a non-object check-runs page")
        runs = page.get("check_runs", [])
        if not isinstance(runs, list):
            raise DependencyTrainError("gh returned invalid check-runs data")
        for run in runs:
            if not isinstance(run, Mapping):
                raise DependencyTrainError("gh returned a non-object check run")
            records.append(run)
    return records


def _status_records(payload: Any) -> list[Mapping[str, Any]]:
    """Extract commit-status contexts from the combined status response."""

    if not isinstance(payload, Mapping):
        raise DependencyTrainError("gh returned an invalid combined status response")
    statuses = payload.get("statuses", [])
    if not isinstance(statuses, list):
        raise DependencyTrainError("gh returned invalid commit-status data")
    records: list[Mapping[str, Any]] = []
    for status in statuses:
        if not isinstance(status, Mapping):
            raise DependencyTrainError("gh returned a non-object commit status")
        records.append(status)
    return records


def _check_record_name(record: Mapping[str, Any], fallback: str) -> str:
    name = record.get("name") or record.get("context")
    if isinstance(name, str) and name.strip():
        return name.strip()
    app = record.get("app")
    if isinstance(app, Mapping):
        app_name = app.get("name")
        if isinstance(app_name, str) and app_name.strip():
            return app_name.strip()
    return fallback


def evaluate_commit_checks(
    check_runs_payload: Any,
    statuses_payload: Any,
) -> CheckEvaluation:
    """Require at least one completed, non-failing check for a commit.

    A check run is ready only when it is completed with ``success``,
    ``neutral`` or ``skipped``.  Queued/in-progress checks are pending;
    failure, cancellation, timeout, action-required and unknown conclusions
    are failed.  The combined commit-status API is evaluated with the same
    policy.  Zero check-runs and zero statuses are treated as pending and are
    therefore skipped by the train until a source check is reported.
    """

    check_runs = _check_run_records(check_runs_payload)
    statuses = _status_records(statuses_payload)
    if not check_runs and not statuses:
        return CheckEvaluation("pending", ("no checks reported; treated as pending",))

    pending: list[str] = []
    failed: list[str] = []
    for index, run in enumerate(check_runs, start=1):
        name = _check_record_name(run, f"check run {index}")
        status = run.get("status")
        normalized_status = status.strip().lower() if isinstance(status, str) else ""
        if normalized_status != "completed":
            state = normalized_status or "unknown status"
            pending.append(f"{name}: {state}")
            continue
        conclusion = run.get("conclusion")
        normalized_conclusion = conclusion.strip().lower() if isinstance(conclusion, str) else ""
        if normalized_conclusion not in CHECK_ALLOWED_CONCLUSIONS:
            if not normalized_conclusion:
                normalized_conclusion = "unknown conclusion"
            failed.append(f"{name}: {normalized_conclusion}")

    for index, status in enumerate(statuses, start=1):
        name = _check_record_name(status, f"commit status {index}")
        state = status.get("state")
        normalized_state = state.strip().lower() if isinstance(state, str) else ""
        if normalized_state == STATUS_SUCCESS:
            continue
        if normalized_state in CHECK_PENDING_STATUSES:
            pending.append(f"{name}: {normalized_state}")
            continue
        if normalized_state in STATUS_FAILED or not normalized_state:
            failed.append(f"{name}: {normalized_state or 'unknown state'}")
            continue
        failed.append(f"{name}: {normalized_state}")

    if failed:
        return CheckEvaluation("failed", tuple(failed[:10]))
    if pending:
        return CheckEvaluation("pending", tuple(pending[:10]))
    return CheckEvaluation("ready")


def _nested_string(value: Any, *keys: str) -> str | None:
    current = value
    for key in keys:
        if not isinstance(current, Mapping):
            return None
        current = current.get(key)
    return current if isinstance(current, str) else None


def _parse_pull_request(raw: Mapping[str, Any]) -> PullRequest:
    number = raw.get("number")
    if isinstance(number, bool) or not isinstance(number, int) or number <= 0:
        raise DependencyTrainError("gh returned a pull request without a valid number")

    head_sha = _nested_string(raw, "head", "sha") or ""
    if not SHA_PATTERN.fullmatch(head_sha):
        raise DependencyTrainError(f"pull request #{number} has an invalid head SHA")

    labels_raw = raw.get("labels", [])
    if not isinstance(labels_raw, list):
        raise DependencyTrainError(f"pull request #{number} has invalid labels")
    labels: list[str] = []
    for label in labels_raw:
        name = _nested_string(label, "name")
        if name:
            labels.append(name)

    return PullRequest(
        number=number,
        title=raw.get("title") if isinstance(raw.get("title"), str) else f"Dependabot PR #{number}",
        body=raw.get("body") if isinstance(raw.get("body"), str) else "",
        url=raw.get("html_url") if isinstance(raw.get("html_url"), str) else "",
        state=raw.get("state") if isinstance(raw.get("state"), str) else "",
        author=_nested_string(raw, "user", "login") or "",
        base_ref=_nested_string(raw, "base", "ref") or "",
        base_repository=_nested_string(raw, "base", "repo", "full_name"),
        head_ref=_nested_string(raw, "head", "ref") or "",
        head_sha=head_sha,
        head_repository=_nested_string(raw, "head", "repo", "full_name"),
        draft=raw.get("draft") is True,
        labels=tuple(labels),
    )


def parse_pull_requests(payload: Any) -> tuple[PullRequest, ...]:
    """Parse a GitHub pull-request list response without filtering it."""

    pull_requests: list[PullRequest] = []
    for raw in _flatten_pages(payload):
        if not isinstance(raw, Mapping):
            raise DependencyTrainError("gh returned a non-object pull request")
        pull_requests.append(_parse_pull_request(raw))
    return tuple(pull_requests)


def _is_major_update(pr: PullRequest) -> bool:
    normalized_labels = {label.strip().lower() for label in pr.labels}
    if normalized_labels & RISKY_LABELS:
        return True
    if re.search(r"\b(?:major|breaking)\b", pr.title, flags=re.IGNORECASE):
        return True

    versions = re.search(
        r"\bfrom\s+v?(\d+)\.[0-9]+\.[0-9]+\s+to\s+v?(\d+)\.[0-9]+\.[0-9]+\b",
        pr.title,
        flags=re.IGNORECASE,
    )
    return bool(versions and versions.group(1) != versions.group(2))


def _risky_path_reason(path: str) -> str | None:
    normalized = path.lower()
    if normalized.startswith(RISKY_PATH_PREFIXES):
        return "control-plane or deployment path changed"
    basename = normalized.rsplit("/", 1)[-1]
    if basename in RISKY_PATH_NAMES:
        return "container/build control path changed"
    if normalized.endswith(RISKY_PATH_SUFFIXES):
        return "executable shell script changed"
    return None


def risk_reasons(pr: PullRequest, changed_files: Iterable[str]) -> tuple[str, ...]:
    """Return deterministic reasons a PR must remain individually reviewable."""

    reasons: list[str] = []
    if _is_major_update(pr):
        reasons.append("major or breaking dependency update")
    risky_paths = [path for path in changed_files if _risky_path_reason(path)]
    if risky_paths:
        reasons.append(
            "sensitive paths changed: "
            + ", ".join(sorted(risky_paths)[:5])
            + (" (and more)" if len(risky_paths) > 5 else "")
        )
    return tuple(reasons)


def source_set_fingerprint(items: Iterable[TrainItem]) -> str:
    """Hash the sorted PR number, verified head SHA and final disposition."""

    records: list[str] = []
    for item in items:
        if item.category not in {"included", "skipped", "conflicting", "risky"}:
            raise DependencyTrainError(f"invalid train disposition: {item.category!r}")
        head_sha = item.pull_request.head_sha.lower()
        if not SHA_PATTERN.fullmatch(head_sha):
            raise DependencyTrainError(
                f"pull request #{item.pull_request.number} has an invalid fingerprint SHA"
            )
        records.append(f"{item.pull_request.number}\t{head_sha}\t{item.category}")
    canonical = "\n".join(sorted(records))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def extract_source_set_fingerprint(body: str) -> str | None:
    """Read the managed source-set fingerprint from an existing train body."""

    match = FINGERPRINT_PATTERN.search(body)
    return match.group(1) if match else None


def _valid_branch_name(branch: str) -> bool:
    return bool(
        BRANCH_PATTERN.fullmatch(branch)
        and not branch.startswith("-")
        and not branch.startswith("/")
        and not branch.endswith("/")
        and ".." not in branch
        and "@{" not in branch
    )


def _validate_options(base_branch: str, train_branch: str) -> None:
    if not _valid_branch_name(base_branch):
        raise DependencyTrainError(f"invalid base branch name: {base_branch!r}")
    if not _valid_branch_name(train_branch):
        raise DependencyTrainError(f"invalid train branch name: {train_branch!r}")


def _repository_owner(repository: str) -> str:
    if not REPOSITORY_PATTERN.fullmatch(repository):
        raise DependencyTrainError(f"repository must be OWNER/NAME, got {repository!r}")
    owner, separator, name = repository.partition("/")
    if not separator or not owner or not name or "/" in name:
        raise DependencyTrainError(f"repository must be OWNER/NAME, got {repository!r}")
    return owner


def _validate_remote(remote: str) -> None:
    if not REMOTE_PATTERN.fullmatch(remote) or remote.startswith("-"):
        raise DependencyTrainError(f"invalid git remote name: {remote!r}")


def _fetch_base(repository_root: Path, remote: str, base_branch: str) -> str:
    _git(
        repository_root,
        [
            "fetch",
            "--no-tags",
            remote,
            f"refs/heads/{base_branch}:refs/remotes/{remote}/{base_branch}",
        ],
    )
    result = _git(repository_root, ["rev-parse", f"refs/remotes/{remote}/{base_branch}"])
    base_sha = result.stdout.strip()
    if not SHA_PATTERN.fullmatch(base_sha):
        raise DependencyTrainError("remote base branch did not resolve to a commit")
    return base_sha


def _ensure_clean(repository_root: Path) -> None:
    result = _git(repository_root, ["status", "--porcelain=v1", "--untracked-files=all"])
    if result.stdout.strip():
        raise DependencyTrainError("working tree must be clean before rebuilding the train")


def _ensure_commit_identity(repository_root: Path) -> None:
    defaults = {
        "user.name": "github-actions[bot]",
        "user.email": "41898282+github-actions[bot]@users.noreply.github.com",
    }
    for key, value in defaults.items():
        result = _git(repository_root, ["config", "--local", "--get", key], check=False)
        if not result.stdout.strip():
            _git(repository_root, ["config", "--local", key, value])


def _changed_files(repository_root: Path, base_sha: str, head_sha: str) -> tuple[str, ...]:
    result = _git(
        repository_root,
        ["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", f"{base_sha}...{head_sha}"],
    )
    return tuple(path for path in result.stdout.split("\x00") if path)


def _fetch_pull_request(
    repository_root: Path,
    remote: str,
    pull_request: PullRequest,
) -> tuple[str, str | None]:
    """Fetch and verify a PR head, returning its local ref and an error reason."""

    local_ref = f"refs/remotes/dependency-train/pr-{pull_request.number}"
    try:
        _git(
            repository_root,
            [
                "fetch",
                "--no-tags",
                "--force",
                remote,
                f"refs/pull/{pull_request.number}/head:{local_ref}",
            ],
        )
        result = _git(repository_root, ["rev-parse", f"{local_ref}^{{commit}}"])
    except DependencyTrainError as error:
        return local_ref, f"unable to fetch PR head: {error}"

    actual_sha = result.stdout.strip().lower()
    if actual_sha != pull_request.head_sha.lower():
        return local_ref, "head changed while the train was being built"
    return local_ref, None


def _merge_pull_request(
    repository_root: Path,
    local_ref: str,
    pull_request: PullRequest,
) -> tuple[bool, str]:
    """Merge one verified head, aborting cleanly when it conflicts."""

    result = _git(
        repository_root,
        [
            "merge",
            "--no-ff",
            "--no-commit",
            "--no-verify",
            "--no-edit",
            local_ref,
        ],
        check=False,
    )
    if result.returncode != 0:
        _git(repository_root, ["merge", "--abort"], check=False)
        return False, "merge conflict with another selected Dependabot update"

    staged = _git(repository_root, ["diff", "--cached", "--quiet"], check=False)
    if staged.returncode == 0:
        # ``git merge`` may have found the head already contained in the train.
        _git(repository_root, ["merge", "--abort"], check=False)
        return False, "changes already present in the train"

    subject = f"chore(deps): include Dependabot PR #{pull_request.number}"
    body = f"Source: {pull_request.url or f'PR #{pull_request.number}'}"
    _git(repository_root, ["commit", "--no-verify", "-m", subject, "-m", body])
    return True, ""


def _escape_markdown(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("\r", " ")
        .replace("\n", " ")
        .replace("`", "\\`")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def _pull_request_label(item: TrainItem) -> str:
    pr = item.pull_request
    title = _escape_markdown(pr.title.strip() or f"Dependabot PR #{pr.number}")
    url = pr.url if pr.url.startswith("https://github.com/") else ""
    if url:
        return f"- [#{pr.number}]({url}) — {title} ({_escape_markdown(item.reason)})"
    return f"- PR #{pr.number} — {title} ({_escape_markdown(item.reason)})"


def _render_items(heading: str, items: Sequence[TrainItem]) -> list[str]:
    lines = [f"### {heading}", ""]
    if items:
        lines.extend(_pull_request_label(item) for item in items)
    else:
        lines.append("- None")
    lines.append("")
    return lines


def render_train_section(
    *,
    base_sha: str,
    included: Sequence[TrainItem],
    skipped: Sequence[TrainItem],
    conflicting: Sequence[TrainItem],
    risky: Sequence[TrainItem],
    source_fingerprint: str | None = None,
) -> str:
    """Render the managed Markdown section for the consolidation PR."""

    all_items = (*included, *skipped, *conflicting, *risky)
    source_fingerprint = source_fingerprint or source_set_fingerprint(all_items)
    lines = [
        TRAIN_MARKER_START,
        "## Dependency train",
        "",
        "This review-only branch is rebuilt from the current `main` commit. "
        "No source Dependabot pull request is closed or merged automatically.",
        "Source heads must report at least one completed, non-failing check. "
        "Zero reported checks are treated as pending and remain skipped.",
        "",
        f"- Base commit: `{base_sha}`",
        f"- Source-set fingerprint: `{source_fingerprint}`",
        f"- Included updates: {len(included)}",
        f"- Skipped updates: {len(skipped)}",
        f"- Conflicting updates: {len(conflicting)}",
        f"- Risky updates: {len(risky)}",
        "",
    ]
    lines.extend(_render_items("Included Dependabot PRs", included))
    lines.extend(_render_items("Skipped Dependabot PRs", skipped))
    lines.extend(_render_items("Conflicting Dependabot PRs", conflicting))
    lines.extend(_render_items("Risky Dependabot PRs", risky))
    lines.append(TRAIN_MARKER_END)
    return "\n".join(lines).rstrip()


def update_managed_body(existing_body: str, managed_section: str) -> str:
    """Replace only the train-owned body section, preserving maintainer notes."""

    start = existing_body.find(TRAIN_MARKER_START)
    end = existing_body.find(TRAIN_MARKER_END)
    if start >= 0 and end >= start:
        end += len(TRAIN_MARKER_END)
        prefix = existing_body[:start].rstrip()
        suffix = existing_body[end:].lstrip()
        parts = [part for part in (prefix, managed_section.strip(), suffix) if part]
        return "\n\n".join(parts) + "\n"

    prefix = existing_body.rstrip()
    if prefix:
        return f"{prefix}\n\n{managed_section.strip()}\n"
    return f"{managed_section.strip()}\n"


def _train_pull_requests(
    repository_root: Path,
    repository: str,
    base_branch: str,
    train_branch: str,
) -> list[dict[str, Any]]:
    encoded_base = quote(base_branch, safe="")
    payload = _json_from_gh(
        repository_root,
        [
            "api",
            "--paginate",
            "--slurp",
            f"repos/{repository}/pulls?state=open&base={encoded_base}&per_page=100",
        ],
    )
    records = _flatten_pages(payload)
    owner = _repository_owner(repository)
    return [
        record
        for record in records
        if isinstance(record, Mapping)
        and _nested_string(record, "head", "ref") == train_branch
        and _nested_string(record, "head", "repo", "full_name") == repository
        and _nested_string(record, "base", "ref") == base_branch
        and _nested_string(record, "base", "repo", "full_name") == repository
        and _nested_string(record, "head", "repo", "owner", "login") in {owner, None}
    ]


def _open_dependabot_pull_requests(
    repository_root: Path,
    repository: str,
    base_branch: str,
) -> tuple[PullRequest, ...]:
    encoded_base = quote(base_branch, safe="")
    payload = _json_from_gh(
        repository_root,
        [
            "api",
            "--paginate",
            "--slurp",
            f"repos/{repository}/pulls?state=open&base={encoded_base}&per_page=100",
        ],
    )
    relevant_records: list[Mapping[str, Any]] = []
    for record in _flatten_pages(payload):
        if not isinstance(record, Mapping):
            raise DependencyTrainError("gh returned a non-object pull request")
        if _nested_string(record, "user", "login") == DEPENDABOT_LOGIN:
            relevant_records.append(record)
    return tuple(
        pull_request
        for pull_request in parse_pull_requests(relevant_records)
        if pull_request.state == "open" and pull_request.author == DEPENDABOT_LOGIN
    )


def _commit_checks(
    repository_root: Path,
    repository: str,
    head_sha: str,
) -> CheckEvaluation:
    """Read check-runs and legacy commit statuses for one verified head."""

    if not SHA_PATTERN.fullmatch(head_sha):
        raise DependencyTrainError("cannot query checks for an invalid commit SHA")
    check_runs_payload = _json_from_gh(
        repository_root,
        [
            "api",
            "--paginate",
            "--slurp",
            f"repos/{repository}/commits/{head_sha}/check-runs?per_page=100",
        ],
    )
    statuses_payload = _json_from_gh(
        repository_root,
        ["api", f"repos/{repository}/commits/{head_sha}/status"],
    )
    return evaluate_commit_checks(check_runs_payload, statuses_payload)


def _current_train_pr(
    repository_root: Path,
    repository: str,
    base_branch: str,
    train_branch: str,
) -> tuple[int | None, str, str]:
    records = _train_pull_requests(repository_root, repository, base_branch, train_branch)
    if len(records) > 1:
        numbers = ", ".join(str(record.get("number")) for record in records)
        raise DependencyTrainError(f"more than one open train PR exists: {numbers}")
    if not records:
        return None, "", ""
    record = records[0]
    number = record.get("number")
    if isinstance(number, bool) or not isinstance(number, int) or number <= 0:
        raise DependencyTrainError("existing train PR has an invalid number")
    body = record.get("body") if isinstance(record.get("body"), str) else ""
    url = record.get("html_url") if isinstance(record.get("html_url"), str) else ""
    return number, body, url


def _write_body_file(body: str) -> Path:
    handle = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        prefix="dependency-train-",
        suffix=".md",
        delete=False,
    )
    try:
        handle.write(body)
    finally:
        handle.close()
    return Path(handle.name)


def _push_train_branch(
    repository_root: Path,
    remote: str,
    train_branch: str,
) -> None:
    current = _git(repository_root, ["rev-parse", "HEAD"]).stdout.strip()
    remote_ref = f"refs/heads/{train_branch}"
    result = _git(repository_root, ["ls-remote", "--heads", remote, remote_ref])
    expected = ""
    if result.stdout.strip():
        fields = result.stdout.split()
        if len(fields) < 1 or not SHA_PATTERN.fullmatch(fields[0]):
            raise DependencyTrainError("remote train branch did not resolve to a commit")
        expected = fields[0].lower()

    lease = f"{remote_ref}:{expected}"
    _git(
        repository_root,
        [
            "push",
            f"--force-with-lease={lease}",
            remote,
            f"{current}:refs/heads/{train_branch}",
        ],
    )


def _write_train_pr(
    repository_root: Path,
    repository: str,
    base_branch: str,
    train_branch: str,
    body: str,
    existing_number: int | None,
) -> tuple[int, str]:
    body_file = _write_body_file(body)
    try:
        if existing_number is not None:
            _gh(
                repository_root,
                [
                    "pr",
                    "edit",
                    str(existing_number),
                    "--title",
                    TRAIN_TITLE,
                    "--body-file",
                    str(body_file),
                ],
            )
            records = _train_pull_requests(repository_root, repository, base_branch, train_branch)
            if len(records) != 1:
                raise DependencyTrainError("updated train PR could not be read back safely")
            url = records[0].get("html_url")
            return existing_number, url if isinstance(url, str) else ""

        result = _gh(
            repository_root,
            [
                "pr",
                "create",
                "--base",
                base_branch,
                "--head",
                train_branch,
                "--title",
                TRAIN_TITLE,
                "--body-file",
                str(body_file),
            ],
        )
        url = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
        number_match = re.search(r"/pull/(\d+)(?:$|[/?#])", url)
        if number_match:
            return int(number_match.group(1)), url
        # GitHub CLI normally emits a URL.  A missing number should not make a
        # successful branch push look like a managed PR exists.
        raise DependencyTrainError("gh pr create did not return a pull-request URL")
    finally:
        try:
            body_file.unlink()
        except FileNotFoundError:
            pass


def rebuild_train(
    *,
    repository_root: Path,
    repository: str,
    remote: str = "origin",
    base_branch: str = DEFAULT_BASE_BRANCH,
    train_branch: str = DEFAULT_TRAIN_BRANCH,
    max_pull_requests: int = DEFAULT_MAX_PULL_REQUESTS,
    dry_run: bool = False,
) -> TrainResult:
    """Fetch, classify, combine, and optionally publish the dependency train."""

    _validate_options(base_branch, train_branch)
    _repository_owner(repository)
    if max_pull_requests <= 0:
        raise DependencyTrainError("max pull requests must be positive")
    _validate_remote(remote)
    repository_root = repository_root.resolve()
    _ensure_clean(repository_root)

    # This local configuration prevents repository-provided hooks from running
    # while the untrusted pull-request objects are merged into the worktree.
    hooks_directory = repository_root / ".git" / "dependency-train-empty-hooks"
    hooks_directory.mkdir(parents=True, exist_ok=True)
    _git(repository_root, ["config", "core.hooksPath", str(hooks_directory)])
    _ensure_commit_identity(repository_root)

    base_sha = _fetch_base(repository_root, remote, base_branch)
    existing_number, existing_body, existing_url = _current_train_pr(
        repository_root, repository, base_branch, train_branch
    )
    pull_requests = tuple(
        sorted(
            _open_dependabot_pull_requests(repository_root, repository, base_branch),
            key=lambda pull_request: pull_request.number,
        )
    )
    skipped: list[TrainItem] = []
    risky: list[TrainItem] = []
    candidates: list[tuple[PullRequest, str, tuple[str, ...]]] = []

    for pull_request in pull_requests:
        if pull_request.base_ref != base_branch:
            skipped.append(TrainItem(pull_request, "skipped", "pull request does not target the default branch"))
            continue
        if pull_request.base_repository != repository:
            skipped.append(TrainItem(pull_request, "skipped", "pull request targets another repository"))
            continue
        if pull_request.head_repository != repository:
            risky.append(TrainItem(pull_request, "risky", "head is not from this repository"))
            continue
        if not pull_request.head_ref or pull_request.head_ref == train_branch:
            risky.append(TrainItem(pull_request, "risky", "invalid or reserved train branch name"))
            continue
        if pull_request.draft:
            skipped.append(TrainItem(pull_request, "skipped", "draft pull request is not ready for consolidation"))
            continue
        local_ref, fetch_error = _fetch_pull_request(repository_root, remote, pull_request)
        if fetch_error:
            skipped.append(TrainItem(pull_request, "skipped", fetch_error))
            continue
        try:
            checks = _commit_checks(repository_root, repository, pull_request.head_sha)
        except DependencyTrainError as error:
            skipped.append(
                TrainItem(
                    pull_request,
                    "skipped",
                    f"unable to query source checks: {error}",
                )
            )
            continue
        if checks.disposition != "ready":
            details = "; ".join(checks.details) or checks.disposition
            skipped.append(
                TrainItem(
                    pull_request,
                    "skipped",
                    f"source checks {checks.disposition}: {details}",
                )
            )
            continue
        try:
            changed_files = _changed_files(repository_root, base_sha, pull_request.head_sha)
        except DependencyTrainError as error:
            skipped.append(TrainItem(pull_request, "skipped", f"unable to inspect changed files: {error}"))
            continue
        reasons = risk_reasons(pull_request, changed_files)
        if reasons:
            risky.append(TrainItem(pull_request, "risky", "; ".join(reasons), changed_files))
            continue
        candidates.append((pull_request, local_ref, changed_files))

    # Keep the run bounded even if a repository's Dependabot limits are raised.
    if len(candidates) > max_pull_requests:
        for pull_request, _, changed_files in candidates[max_pull_requests:]:
            skipped.append(
                TrainItem(
                    pull_request,
                    "skipped",
                    f"train limit of {max_pull_requests} pull requests reached",
                    changed_files,
                )
            )
        candidates = candidates[:max_pull_requests]

    included: list[TrainItem] = []
    conflicting: list[TrainItem] = []
    train_pr_number: int | None = existing_number
    train_pr_url: str | None = existing_url or None

    if candidates:
        _git(repository_root, ["switch", "--force-create", train_branch, base_sha])
        for pull_request, local_ref, changed_files in candidates:
            merged, reason = _merge_pull_request(repository_root, local_ref, pull_request)
            if merged:
                included.append(TrainItem(pull_request, "included", "merged", changed_files))
            elif reason == "merge conflict with another selected Dependabot update":
                conflicting.append(TrainItem(pull_request, "conflicting", reason, changed_files))
            else:
                skipped.append(TrainItem(pull_request, "skipped", reason, changed_files))

        # Never publish a train based on a stale default branch.  A later run
        # can rebuild from the new base without rewriting a just-pushed branch.
        latest_base_sha = _fetch_base(repository_root, remote, base_branch)
        if latest_base_sha != base_sha:
            raise DependencyTrainError(
                f"default branch advanced while building the train ({base_sha} -> {latest_base_sha}); retry"
            )

        if included and not dry_run:
            source_fingerprint = source_set_fingerprint(
                (*included, *skipped, *conflicting, *risky)
            )
            if (
                existing_number is not None
                and extract_source_set_fingerprint(existing_body) == source_fingerprint
            ):
                return TrainResult(
                    base_sha=base_sha,
                    included=tuple(included),
                    skipped=tuple(skipped),
                    conflicting=tuple(conflicting),
                    risky=tuple(risky),
                    source_fingerprint=source_fingerprint,
                    train_pr_number=existing_number,
                    train_pr_url=existing_url or None,
                )
            managed = render_train_section(
                base_sha=base_sha,
                included=included,
                skipped=skipped,
                conflicting=conflicting,
                source_fingerprint=source_fingerprint,
                risky=risky,
            )
            body = update_managed_body(existing_body, managed)
            _push_train_branch(repository_root, remote, train_branch)
            train_pr_number, train_pr_url = _write_train_pr(
                repository_root,
                repository,
                base_branch,
                train_branch,
                body,
                existing_number,
            )

    source_fingerprint = source_set_fingerprint(
        (*included, *skipped, *conflicting, *risky)
    )
    result = TrainResult(
        base_sha=base_sha,
        included=tuple(included),
        skipped=tuple(skipped),
        conflicting=tuple(conflicting),
        risky=tuple(risky),
        source_fingerprint=source_fingerprint,
        train_pr_number=train_pr_number,
        train_pr_url=train_pr_url,
    )
    if dry_run:
        print(
            render_train_section(
                base_sha=base_sha,
                included=included,
                skipped=skipped,
                conflicting=conflicting,
                risky=risky,
                source_fingerprint=source_fingerprint,
            )
        )
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository-root", type=Path, default=Path("."))
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--base-branch", default=DEFAULT_BASE_BRANCH)
    parser.add_argument("--train-branch", default=DEFAULT_TRAIN_BRANCH)
    parser.add_argument("--max-pull-requests", type=int, default=DEFAULT_MAX_PULL_REQUESTS)
    parser.add_argument("--dry-run", action="store_true", help="rebuild locally and print the PR body without pushing")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if not args.repository:
        print("--repository or GITHUB_REPOSITORY is required", file=sys.stderr)
        return 2
    try:
        result = rebuild_train(
            repository_root=args.repository_root,
            repository=args.repository,
            remote=args.remote,
            base_branch=args.base_branch,
            train_branch=args.train_branch,
            max_pull_requests=args.max_pull_requests,
            dry_run=args.dry_run,
        )
    except DependencyTrainError as error:
        print(f"dependency train failed: {error}", file=sys.stderr)
        return 1

    print(
        "Dependency train: "
        f"included={len(result.included)} "
        f"skipped={len(result.skipped)} "
        f"conflicting={len(result.conflicting)} "
        f"risky={len(result.risky)}"
    )
    if result.train_pr_url:
        print(f"Train PR: {result.train_pr_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
