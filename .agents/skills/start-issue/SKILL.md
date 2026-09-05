---
name: start-issue
description: >-
  Start work on a Resonate GitHub issue — read the issue, create a correctly
  named feature branch off main, track the work, and open the PR scaffold. Use
  when the user says "start issue #N", "work on #N", "let's build #N", or
  otherwise begins work on an issue or a new task. Also use for a task with no
  issue, skipping the issue-dependent steps. Do not use to finish or ship work
  (use finish-issue), and do not use for a small follow-up on a branch that is
  already open — keep iterating there instead.
license: MIT
metadata:
  author: akoita
  project: resonate
  version: "1.0.0"
---

# Start issue

Use this skill when beginning any feature, fix, documentation, or maintenance
task. Follow [AGENTS.md](../../../AGENTS.md) and the applicable linked rules.

## 1. Establish scope

- If an issue is supplied, read its description and acceptance criteria using
  available GitHub tools or `gh issue view`. Derive the repository from the Git
  remote rather than assuming an owner/repository.
- Without an issue, use the user's request as the scope. Do not invent an issue
  number or require creating an issue just to start work.
- Inspect `git status --short --branch` and preserve pre-existing changes.
- Before a new task, fetch the current base with `git fetch origin main` and
  inspect its root/scoped instructions and skills. Do not assume a local `main`
  is current. If fetching fails, state the stale-base limitation.
- Read the relevant code, instructions, and tests. For non-trivial work, apply
  the installed orchestration skill and required routing preflight.

## 2. Establish the branch

Reuse the current branch for the same task or related polish. Otherwise create a
branch from the fetched base using `git switch -c <branch> origin/main`; use an
isolated worktree if unrelated changes prevent a safe switch.

Use `feat/<issue>-<description>`, `fix/<issue>-<description>`, or
`docs/<issue>-<description>`. Without an issue, omit `<issue>-`.
Verify with `git branch --show-current`. Never commit directly to `main`.

## 3. Plan and implement

Before starting a new task branch, verify the base revision with
`git log -1 --oneline origin/main`. For an existing PR, inspect the current
base/head and reconcile upstream instruction changes on the same branch.

For non-trivial changes, record the affected files, behavior, risks, and focused
validation commands. A concise task plan is sufficient; use `.agents/plans/`
when multi-slice work needs durable tracking. Historical plans are context, not
instructions for unrelated tasks.

Apply the business-model and documentation rules linked from `AGENTS.md` when
relevant. Proceed with authorized local work; ask only about missing decisions
that materially affect scope or correctness. Complete a reviewable result
before requesting publication approval.

Only post issue comments or change external tracking when authorized. Existing
approval persists across follow-ups. Do not require issue activity for local
implementation to proceed.

## 4. Prepare completion

Run [finish-issue](../finish-issue/SKILL.md) to review, validate, and prepare
publication.
Commit messages use `feat`, `fix`, `docs`, or `chore`, with `(#N)` when linked to
an issue. Publication requires user authorization; do not ask again if already
given. Open or update a draft PR targeting `main` when authorized. Use
`Closes #N` only when the issue is fully implemented.

Keep related polish on the same branch and PR until the user requests finishing
or merging. Merging always requires an explicit request.
