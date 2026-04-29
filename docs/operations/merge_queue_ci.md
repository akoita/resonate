# Mergify Merge Queue CI

Resonate uses Mergify's merge queue to batch rapid PR merges without running the expensive full pipeline once per individual merge.

## Model

The CI workflow has three different responsibilities:

| Event | Purpose |
| --- | --- |
| `pull_request` | Fast, path-aware feedback for the PR author. |
| `push` to `mergify/merge-queue/**` | Full validation for the combined Mergify queue candidate before `main` moves. |
| `push` to `main` | Deploy/image handoff from the already-certified candidate. |

Feature branch pushes intentionally do not trigger CI. Open or update a PR to get validation. This avoids the duplicate branch-push plus pull-request runs that used to happen for every published branch.

The workflow still supports GitHub's native `merge_group` event as a future option, but Mergify is the active queue path because GitHub rejected the native `merge_queue` repository ruleset for this user-owned repository.

## Required GitHub Settings

Enable these settings in the `main` branch protection/ruleset:

1. Require a pull request before merging.
2. Require status checks to pass before merging.
3. Require the validation checks from the `CI` workflow:
   - `Detect Changes`
   - `Lint`
   - `Smart Contract Tests`
   - `Backend Unit Tests`
   - `Backend Integration Tests`
   - `Backend Tests`
   - `Demucs Worker Tests`
   - `Build`
   - `E2E Tests`
4. Do not require deploy-only jobs as merge gates:
   - `Build Deployable Frontend Artifact`
   - `Resolve Deploy Image Plan`
   - `Publish Backend Image`
   - `Publish Frontend Image`
   - `Publish Demucs Image`
   - `Publish Deployable Images`

These required checks are already configured in the active `main` repository ruleset. GitHub's native `merge_queue` rule could not be enabled for this repository by REST or GraphQL API.

## Required Mergify Setup

1. Install the Mergify GitHub App on `akoita/resonate`.
2. Keep `.mergify.yml` on `main`.
3. Queue ready PRs with:

   ```text
   @mergifyio queue
   ```

The `main-batch` queue is configured with:

- Merge method: `squash`.
- Maximum PRs to build together: `5`.
- Minimum PRs to merge: `1`.
- Wait time before building a partial batch: `5 minutes`.
- Failure resolution attempts: `3`.

These values give the queue enough time to collect bursts of small PRs while keeping a single urgent PR from waiting too long.

## Developer Flow

1. Push a feature branch.
2. Open a PR to `main`.
3. Wait for path-aware PR CI.
4. When review and PR CI are green, comment `@mergifyio queue`.
5. Mergify creates a queue branch under `mergify/merge-queue/` that contains one or more ready PRs.
6. Full CI runs once on that combined candidate.
7. If it passes, Mergify advances `main`.
8. The `main` push workflow publishes deployable artifacts and writes the deploy manifest.

## Failure Handling

If a queue branch fails:

- Remove or reorder the suspected PR and requeue the remaining entries.
- Re-run the candidate if the failure is clearly transient.
- Split a large batch into smaller groups when the failing PR is not obvious.

Do not bypass the queue for normal feature work. Emergency merges should be rare and must be followed by a manually dispatched `CI` workflow run on `main` and, if needed, a hotfix PR.

## Why Main Push Skips Validation

The `main` push workflow is still useful because it owns deployable image publication and the deploy manifest consumed by `Deploy Handoff`.

The expensive validation jobs are skipped on `main` pushes because Mergify already ran them on the combined candidate before `main` moved. This is what prevents five fast PRs from creating five full validation runs plus five publish pipelines.
