---
description: Finish working on a GitHub issue — verify, test, commit, push, and open/update a PR
---

# Finish Issue Workflow

When the user says "finish issue", "close issue", "wrap up", or wants to
finalize work on the current branch, follow these steps.

> **Important distinction:** finishing a branch means preparing/updating the PR.
> It does not mean waiting through CI, merging, verifying main, cleaning
> branches, and aligning local main unless the user explicitly says `merge`.

> **No-issue mode**: This workflow can be invoked without a linked GitHub issue. When there is no issue, skip all issue-dependent operations (fetching issue details, referencing `#N` in commits/PR, `Closes #N` in PR body, issue-number-based branch naming). Everything else applies normally.

> **Small-polish mode:** When the user is iterating on UI/UX polish, copy, CSS,
> docs, or other low-risk follow-ups, keep all related tweaks on the same
> feature branch and PR until the user explicitly says `finish` or `merge`. Do
> not create, wait on, merge, clean up, and restart a new PR for every small
> correction. The expected loop is: implement tweak → run lean local checks →
> show result → continue on the same branch.

## 1. Verify the branch


- Run `git branch --show-current` to check the current branch
- If on `main`, identify the feature branch for the issue and switch to it
- If no feature branch exists, use the naming and worktree rules in
  [start-issue](start-issue.md).
  - Run `git status` to see uncommitted changes

## 2. Verify implementation coverage

Review the request and, if supplied, the issue acceptance criteria using available
GitHub tools or `gh issue view`. Derive the repository from the Git remote.
Inspect every changed file and complete missing work before publication.

Apply the mandatory scope rules linked from [AGENTS.md](../../AGENTS.md):

- Reconcile feature, User Guide, architecture, RFC, and plan status under
  [documentation and completion](../rules/documentation.md). Partial delivery
  needs durable tracking, an owner-visible reason, and explicit PR boundaries.
  Do not close an incomplete parent feature.
- Review [change impact](../../docs/engineering/change_impact_checklist.md) for
  durable product/platform work. Mention relevant sections and deferrals in
  the PR summary.
- For economic or trust changes, apply [business-model rules](../rules/business-model.md),
  including revenue line/phase, canonical fees, red lines, and vision labels.

## 3. Ensure test coverage

- Inspect `git diff --name-only main` and `git status --short`; the diff alone
  omits untracked new files. Include those files in review and validation.
- For each changed component/module, check if automated tests exist
- Add or update meaningful tests for changed behavior; documentation and other
  reversible, low-impact edits do not need tests that merely mirror the edit.
- Test files should follow the project's existing test conventions and location patterns

## 4. Run tests

Use risk-based local validation. Do **not** run every repository test suite by
default; expensive local checks belong in CI/CD unless the branch is high risk
or the developer explicitly asks for them. Local validation should prove the
changed slice quickly, while CI/CD uses stronger runners for broad confidence.

Documentation/configuration guidance changes: check local links, validate any
changed executable examples or hooks, and run `git diff --check`. Application
suites are unnecessary when application behavior and build inputs are unchanged.

Minimum local gate for code changes:

- Run the focused tests for files and behavior changed in the branch.
- Run the relevant lightweight lint/type checks for touched packages.
- Run `git diff --check`.
- Prefer a 5-15 minute local validation budget for ordinary feature slices and
  UI polish. If a check is expected to exceed that budget, document it as
  deferred to CI/CD instead of running it locally by default.

Backend defaults:

- For controller-only changes, run the matching `*.controller.spec.ts` and/or
  `*.controller.http.spec.ts`.
- For Prisma/database-dependent service behavior, run the matching
  `*.integration.spec.ts` with Testcontainers.
- For shared services, auth, payments, encryption, analytics, public API
  contracts, or event semantics, run the focused tests for each touched shared
  area.
- Defer full Testcontainers/integration sweeps to CI/CD for normal PRs.
- Run full `cd backend && npm run test` only when the branch broadly changes
  shared runtime behavior, test infrastructure, module bootstrapping, auth
  foundations, or when the developer explicitly asks for a full local suite.

Frontend defaults:

- Run focused Vitest files for changed helpers/components.
- For component/CSS-only UI polish, run changed-file lint where practical
  (for example `cd web && npx eslint <changed-ts-or-tsx-files>`) plus focused
  component/helper tests if they exist. Do not run a full production build by
  default for CSS/layout-only polish.
- Run `cd web && npm run lint` when the change spans multiple frontend areas,
  touches shared code, or changed-file lint is not practical.
- Run `cd web && npm run build` only when routes, client/server boundaries,
  framework config, package/dependency files, environment handling, API helper
  types, or shared frontend build inputs changed. Otherwise defer production
  build validation to CI/CD.
- Run full `cd web && npm run test:unit` when shared frontend helpers,
  analytics/event contracts, auth/session handling, or broad UI state behavior
  changed, or when the developer explicitly asks.

If any focused or required validation fails, fix the code or tests and re-run
the failed gate. Do not proceed until the selected local gates pass. Document
the exact selected gates and any intentionally deferred full-suite coverage in
the PR body.

## 5. Run security scans (if applicable)

Check the changed files (`git diff --name-only main`) and run the appropriate security scans. Scope completion reviews to the changed code and affected call paths; a full repository audit is a separate task. Contract changes also require the [verification ladder](../rules/contracts.md); the general time budget does not waive it:

- **If `contracts/` files changed:** Run the `/smart-contract-scan` workflow. This produces `audit/scv-scan-report.md`. If any High or Critical findings are reported, fix them before proceeding.
- **If `backend/` files changed:** Run the `/security-best-practices` workflow. This produces `audit/security_best_practices_report.md`. If any Critical or High findings are reported, fix them before proceeding.
- **For frontend security-sensitive changes** (auth/session, permissions, data
  handling, or secrets), also run `/security-best-practices`.
- **If no relevant code changed**, skip this step. Documentation-only edits under
  `contracts/` or `backend/` do not trigger a code audit.
- Commit the updated scan reports alongside the code changes.

## 6. Verify documentation

Confirm the documentation obligations identified in step 2 are implemented in
this branch, including architecture diagrams when flows or boundaries changed.
Feature docs explain current behavior; RFCs explain design intent. For user
behavior changes, verify the User Guide content and referenced screenshots with
`cd web && npx vitest run src/lib/help`.

## 7. Check publication authorization

Complete local changes, review, and validation before asking for commit/push
approval. Reuse authorization already given in the conversation. If publication
is not authorized, present the concrete diff and validation result for approval.
This gate does not block local implementation or fixes.

## 8. Clean commit(s)

- Review staged/unstaged changes: `git diff --cached` and `git diff`
- **Security check** — make sure NONE of these are committed:
  - `.env` files, API keys, secrets, tokens, private keys
  - **Hardcoded credentials in ANY file** (e.g. passwords, API keys, wallet private keys embedded in source code, config files, scripts, Terraform tfvars, or Docker compose files)
  - Large binary files, `node_modules/`, build artifacts
  - Database dumps, logs, local config overrides
- Check `.gitignore` covers suspicious files: `git status --ignored`
- If sensitive files are tracked, stop publication and remove them from the
  proposed change. `.gitignore` does not untrack files or erase history; report
  credential exposure for rotation/remediation without printing the secret.
- Make atomic, well-scoped commits:
  - Use `feat`, `fix`, `docs`, or `chore`, with `(#N)` for a linked issue.
  - Examples: `docs(#N): clarify setup` or `chore: simplify agent config`.
  - One logical change per commit — split if needed

## 9. Push the branch


- Push to remote: `git push -u origin <branch-name>`
- Verify the push succeeded

## 10. Create or update the PR

- If a PR for the branch already exists, update it by pushing the branch and
  editing the PR body only when the summary or validation materially changed.
- If no PR exists, create a Pull Request targeting `main` with:
  - Title: concise description (referencing the issue number if one exists)
  - Body: summary, validation, and relevant impact/deferral notes. With a linked
    issue, use `Closes #N` only when fully implemented; otherwise use `Refs #N`.
- Leave the PR in draft unless the user asks for ready-for-review or merge.
- Do not wait synchronously for all PR CI checks unless the user explicitly asks
  to wait. Report current CI status and let CI/CD continue asynchronously.
- If CI later fails, fix on the same branch and push another commit.

## 11. Merge only on explicit request

Run this step only when the user says `merge`, `you can merge`, or equivalent.

- Check the PR state and CI/CD status.
- If required checks are still running, prefer enabling auto-merge or adding the
  PR to the merge queue rather than polling for several minutes, unless the user
  explicitly asks you to wait in the thread.
- If required checks passed, mark the PR ready if needed and merge it (prefer
  squash merge for clean history).
- If CI failed, do not merge. Fix on the same branch, push, and re-check.
- After merge, do not wait synchronously for duplicate main-branch CI unless
  the user asks. Check once for obvious failure; if a failure appears, create a
  hotfix branch and fix it.

## 12. Clean up branches after merge

- Delete the feature branch remotely: `git push origin --delete <branch-name>`
- Switch to `main` once the worktree is clean, then delete the local feature
  branch with `git branch -d <branch-name>`. If Git refuses after squash merge,
  verify the branch content was merged before requesting or applying any
  authorized forced deletion.
- Delete only branches belonging to this merged task; preserve unrelated work.
- **NEVER delete `main`**

## 13. Align local main after merge


- Switch to main: `git checkout main`
  - Pull latest: `git pull --ff-only origin main`
  - Verify alignment: `git log --oneline -5`
