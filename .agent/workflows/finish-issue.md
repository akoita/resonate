---
description: Finish working on a GitHub issue — verify, test, commit, push, PR, merge, and clean up branches
---

# Finish Issue Workflow

When the user says "finish issue", "close issue", "wrap up", or wants to finalize work on the current issue, follow these steps:

## 1. Verify the branch

// turbo

- Run `git branch --show-current` to check the current branch
- If on `main`, identify the feature branch for the issue and switch to it
- If no feature branch exists, create one following the convention: `feat/<issue-number>-<short-kebab-description>` (or `fix/` for bugs)
  // turbo
- Run `git status` to see uncommitted changes

## 2. Verify implementation coverage

- Fetch the issue details from GitHub using `issue_read` (owner: `akoita`, repo: `resonate`)
- Re-read the issue acceptance criteria and scope
- Review every modified/added file against the issue requirements
- If anything is missing, implement it before proceeding

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

## 6. Clean commit(s)

- Review staged/unstaged changes: `git diff --cached` and `git diff`
- **Security check** — make sure NONE of these are committed:
  - `.env` files, API keys, secrets, tokens, private keys
  - Large binary files, `node_modules/`, build artifacts
  - Database dumps, logs, local config overrides
- Check `.gitignore` covers suspicious files: `git status --ignored`
- If any sensitive files are tracked, add them to `.gitignore` first
- Make atomic, well-scoped commits referencing the issue:
  - Format: `feat(#N): description` or `fix(#N): description`
  - One logical change per commit — split if needed

## 7. Push the branch

// turbo

- Push to remote: `git push -u origin <branch-name>`
- Verify the push succeeded

## 8. Verify CI passes on the branch

- Check the CI/CD status on the pushed branch via GitHub
- If CI fails, fix the issues locally, commit, and push again
- Do NOT proceed to PR until CI is green

## 9. Create PR and merge

- Create a Pull Request targeting `main` with:
  - Title: concise description referencing the issue
  - Body: summary of changes + `Closes #N`
- Wait for CI checks on the PR
- If CI passes, merge the PR (prefer squash merge for clean history)
- If CI fails, fix on the branch, push, and re-check

## 10. Verify main branch CI

- After merge, check that CI passes on the updated `main` branch
- If CI fails on main:
  - Create a fix branch: `fix/<issue-number>-<issue-title-kebab>-hotfix`
  - Fix the issue, push, create PR, merge
  - Repeat until main CI is green

## 11. Clean up branches

- Delete the feature branch remotely: `git push origin --delete <branch-name>`
- Delete the feature branch locally: `git branch -d <branch-name>`
- Delete any fix branches (remote + local) the same way
- **NEVER delete `main`**

## 12. Align local main

// turbo

- Switch to main: `git checkout main`
  // turbo
- Pull latest: `git pull origin main`
  // turbo
- Verify alignment: `git log --oneline -5`

## Important rules

- **NEVER force-push to `main`**
- **NEVER delete `main`** — only delete feature and fix branches
- **ALWAYS verify CI** before and after merging
- If in doubt about sensitive files, ask the user before committing
- If the merge creates conflicts, resolve them on the feature branch before merging
