---
description: Finish working on a GitHub issue — verify, test, commit, push, PR, merge, and clean up branches
---

# Finish Issue Workflow

When the user says "finish issue", "close issue", "wrap up", or wants to finalize work on the current branch, follow these steps.

> **No-issue mode**: This workflow can be invoked without a linked GitHub issue. When there is no issue, skip all issue-dependent operations (fetching issue details, referencing `#N` in commits/PR, `Closes #N` in PR body, issue-number-based branch naming). Everything else applies normally.

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

## 3. Ensure test coverage

- Identify all changed and new files: `git diff --name-only main`
- For each changed component/module, check if automated tests exist
- If tests are missing or outdated, create or update them
- Test files should follow the project's existing test conventions and location patterns

## 4. Run tests

- Run the project test suite: `npm test` (or equivalent)
- If any tests fail, fix the code or tests and re-run
- Do NOT proceed until all tests pass

## 5. Update documentation (if convenient)

- Check if the change affects any existing docs (READMEs, RFCs, specs, API docs)
- If so, update them in the same branch — keep docs close to the code they describe
- For new features or architectural changes, add documentation in the appropriate location:
  - `docs/phase0/` or `docs/phase1/` for phase-specific specs
  - `docs/rfc/` for design proposals
  - Inline JSDoc / NatSpec for code-level APIs
- Skip this step if the change is trivial or purely internal refactoring

## 6. Update architecture docs (if the architecture evolved)

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

## 7. Clean commit(s)

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

## 8. Push the branch

// turbo

- Push to remote: `git push -u origin <branch-name>`
- Verify the push succeeded

## 9. Verify CI passes on the branch

- Check the CI/CD status on the pushed branch via GitHub
- If CI fails, fix the issues locally, commit, and push again
- Do NOT proceed to PR until CI is green

## 10. Create PR and merge

- Create a Pull Request targeting `main` with:
  - Title: concise description (referencing the issue number if one exists)
  - Body: summary of changes (+ `Closes #N` only if an issue exists)
- Wait for CI checks on the PR
- If CI passes, merge the PR (prefer squash merge for clean history)
- If CI fails, fix on the branch, push, and re-check

## 11. Verify main branch CI

- After merge, check that CI passes on the updated `main` branch
- If CI fails on main:
  - Create a fix branch: `fix/<issue-number>-<issue-title-kebab>-hotfix` (or `fix/<short-description>-hotfix` if no issue)
  - Fix the issue, push, create PR, merge
  - Repeat until main CI is green

## 12. Clean up branches

- Delete the feature branch remotely: `git push origin --delete <branch-name>`
- Delete the feature branch locally: `git branch -d <branch-name>`
- Delete any fix branches (remote + local) the same way
- **NEVER delete `main`**

## 13. Align local main

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
- **ALWAYS verify CI** before and after merging
- If in doubt about sensitive files, ask the user before committing
- If the merge creates conflicts, resolve them on the feature branch before merging
