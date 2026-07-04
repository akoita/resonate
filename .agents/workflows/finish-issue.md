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

// turbo

- Run `git branch --show-current` to check the current branch
- If on `main`, identify the feature branch for the issue and switch to it
- If no feature branch exists, create one following the convention: `feat/<issue-number>-<short-kebab-description>` (or `fix/` for bugs)
  // turbo
- Run `git status` to see uncommitted changes

## 2. Verify implementation coverage

- **If an issue exists:** Fetch the issue details from GitHub using `issue_read` (owner: `akoita`, repo: `resonate`), re-read the acceptance criteria and scope, and review every modified/added file against the issue requirements. If anything is missing, implement it before proceeding.
- **If no issue:** Review the modified/added files to confirm the intended change is complete.
- **No silent partials:** If this PR intentionally implements only one slice of
  a larger feature, do not proceed until the remaining work is durable and
  owner-visible. Use one or more of:
  - keep the parent issue open with an explicit remaining-work checklist;
  - create/link follow-up issues;
  - update a feature plan or roadmap doc with slice statuses;
  - mark the feature catalog entry or feature page as `partial`/`in-progress`
    and link to the tracking source.
  The PR body must distinguish "implemented in this PR" from "remaining /
  deferred" work. Do not close a parent feature issue unless the feature is
  usable end to end or every remaining slice has explicit follow-up tracking.
- Reconcile linked roadmap, plan, RFC, and feature docs before proceeding.
  If a linked plan contains slices, milestones, or deliverables beyond the issue
  acceptance criteria, update their status explicitly (`implemented`, `partial`,
  `deferred`, or `planned`) and create/link follow-up issues for any intentional
  deferral. Mention those follow-ups in the PR body instead of implying the
  broader plan is complete.
- Review `docs/engineering/change_impact_checklist.md` for every durable change.
  Identify which sections apply, especially analytics/events, API contracts,
  privacy/permissions, moderation, lifecycle state, docs, deployment/env, and
  validation scope. Implement any missing required updates before proceeding.
  Mention the relevant checklist sections or intentional deferrals in the PR
  summary.
- **Business-model conformance** (CLAUDE.md "💰 Business Model Conformance"):
  if the change touches money, fees, payouts, upload/ingestion trust,
  AI-generation billing, collectibles, or licensing — confirm the ADR-BM-4 red
  lines are respected, state the revenue line/phase (ADR-BM-6) in the PR body,
  and reconcile any new or changed fee/split/price into
  `docs/rfc/business-model.md` (the single canonical source). Vision-neutral
  changes (infra/quality) can say so explicitly.

## 3. Ensure test coverage

- Identify all changed and new files: `git diff --name-only main`
- For each changed component/module, check if automated tests exist
- If tests are missing or outdated, create or update them
- Test files should follow the project's existing test conventions and location patterns

## 4. Run tests

Use risk-based local validation. Do **not** run every repository test suite by
default; expensive local checks belong in CI/CD unless the branch is high risk
or the developer explicitly asks for them. Local validation should prove the
changed slice quickly, while CI/CD uses stronger runners for broad confidence.

Minimum local gate:

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

Check the changed files (`git diff --name-only main`) and run the appropriate security scans:

- **If `contracts/` files changed:** Run the `/smart-contract-scan` workflow. This produces `scv-scan-report.md`. If any High or Critical findings are reported, fix them before proceeding.
- **If `backend/` files changed:** Run the `/security-best-practices` workflow. This produces `security_best_practices_report.md`. If any Critical or High findings are reported, fix them before proceeding.
- **If neither changed**, skip this step.
- Commit the updated scan reports alongside the code changes.

## 6. Update documentation

- Check if the change affects any existing docs (READMEs, RFCs, specs, API docs)
- If so, update them in the same branch — keep docs close to the code they describe
- For new features or architectural changes, add documentation in the appropriate location:
  - `docs/features/` for user-facing or developer-facing feature references
  - `docs/rfc/` for design proposals
  - Inline JSDoc / NatSpec for code-level APIs
- For every durable feature that is added, materially changed, exposed, hidden, or removed:
  - update `docs/features/README.md`
  - add or update the feature's dedicated page with status, use cases, API/UI entry points, test steps, and related docs
- **If the change is user-facing** (something a listener, artist, producer, curator, or operator can see or do), update the in-app **User Guide** in the same branch:
  - edit or add the matching article in `web/src/lib/help/content.ts` (plain language; accurate `keywords`/`appLinks`/`related`/`status`)
  - add or refresh a screenshot where a public or signed-in screen exists (`web/scripts/capture-help-screenshots.mjs`)
  - keep `web/src/lib/help/help.test.ts` green (`cd web && npx vitest run src/lib/help`)
- Skip this step if the change is trivial or purely internal refactoring

## 7. Update architecture docs

- Think about whether this change introduces or modifies **architectural patterns** — new services, data flows, module boundaries, smart contract interactions, event flows, etc.
- If the architecture has evolved:
  - Search for **all related architecture docs** in `docs/`, `docs/rfc/`, `docs/phase*/`, and any architecture diagrams (Mermaid, draw.io, etc.)
  - Update them in-place to reflect the new state — keep diagrams, flow descriptions, and component lists current
  - If no existing doc covers the new architecture area, **create a new doc** in the appropriate location (e.g. `docs/architecture/agent_wallet.md`) with:
    - High-level overview and motivation
    - Component diagram (Mermaid preferred)
    - Data flow / sequence diagram for key operations
    - Key design decisions and trade-offs
- Skip this step if the change is purely internal refactoring with no architectural impact

## 8. Clean commit(s)

- Review staged/unstaged changes: `git diff --cached` and `git diff`
- **Security check** — make sure NONE of these are committed:
  - `.env` files, API keys, secrets, tokens, private keys
  - **Hardcoded credentials in ANY file** (e.g. passwords, API keys, wallet private keys embedded in source code, config files, scripts, Terraform tfvars, or Docker compose files)
  - Large binary files, `node_modules/`, build artifacts
  - Database dumps, logs, local config overrides
- Check `.gitignore` covers suspicious files: `git status --ignored`
- If any sensitive files are tracked, add them to `.gitignore` first
- Make atomic, well-scoped commits:
  - **With issue:** `feat(#N): description` or `fix(#N): description`
  - **Without issue:** `feat: description` or `fix: description`
  - One logical change per commit — split if needed

## 9. Push the branch

// turbo

- Push to remote: `git push -u origin <branch-name>`
- Verify the push succeeded

## 10. Create or update the PR

- If a PR for the branch already exists, update it by pushing the branch and
  editing the PR body only when the summary or validation materially changed.
- If no PR exists, create a Pull Request targeting `main` with:
  - Title: concise description (referencing the issue number if one exists)
  - Body: summary of changes (+ `Closes #N` only if an issue exists)
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
- Delete the feature branch locally: `git branch -d <branch-name>`
- Delete any fix branches (remote + local) the same way
- **NEVER delete `main`**

## 13. Align local main after merge

// turbo

- Switch to main: `git checkout main`
  // turbo
- Pull latest: `git pull origin main`
  // turbo
- Verify alignment: `git log --oneline -5`

## Important rules

- **NEVER push a file that contains clear private data** — no hardcoded credentials, API keys, passwords, private keys, or tokens in ANY file, regardless of file type. Scan every file before staging. This has happened before and must never happen again.
- **NEVER commit or push before user approval** — always ask first
- **NEVER force-push to `main`**
- **NEVER delete `main`** — only delete feature and fix branches
- **ALWAYS verify required PR CI before merging**, but do not turn every PR into
  a synchronous wait loop. Use async CI status reporting or auto-merge/merge
  queue when checks are still running.
- If in doubt about sensitive files, ask the user before committing
- If the merge creates conflicts, resolve them on the feature branch before merging
