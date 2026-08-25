# Mergify Merge Queue CI

Resonate uses Mergify's merge queue to combine ready pull requests and validate
the exact candidate that will reach `main`. CI is a validation service only.
It does not publish deployable images, write an analytics template, dispatch
`resonate-iac`, or deploy an environment.

## Model

The active CI events have these responsibilities:

| Event | Purpose |
| --- | --- |
| `pull_request` | Path-aware validation for the author, including queue-created PRs. |
| `merge_group` | Full validation for a native GitHub merge-queue candidate when that event is enabled. |
| `push` to `develop` | Validation of the merged develop revision. |
| `push` to `main` | A lightweight post-merge validation receipt for the queue-certified revision; it does not repeat the full queue graph or publish anything. |
| reusable `workflow_call` | Full validation invoked by the explicit Release Deployment workflow for its exact source SHA. |

Feature-branch pushes do not trigger CI by themselves. Open or update a PR to
get validation. This avoids duplicate branch-push and pull-request runs for
the same work.

Mergify remains the active queue path because GitHub's native merge-queue
ruleset is not enabled for this repository. Whether Mergify uses a draft PR or
the native `merge_group` event, the candidate must pass validation before it
can move `main`.

Image publication and deployment are separate operator actions. Start the
manual **Release Deployment** workflow only after selecting the exact source
SHA and a successful CI run for that SHA. See the
[release operations runbook](release_process.md).

## Required GitHub Settings

Enable these settings in the `main` branch protection/ruleset:

1. Require a pull request before merging.
2. Require status checks to pass before merging.
3. Require only validation checks from the `CI` workflow, such as:
   - `Detect Changes`
   - `Lint`
   - `Smart Contract Tests`
   - `Backend Unit Tests`
   - `Backend Integration Tests`
   - `Backend Tests`
   - `Demucs Worker Tests`
   - `Build`
   - `E2E Tests`
4. Do not make Release Deployment, Publish Deployable Images, Deploy Handoff,
   Analytics Dataflow publication, or Software Release jobs merge gates.

The exact check names are the validation jobs currently emitted by `CI`.
Release-only jobs require their own exact-SHA and environment protections and
must never be satisfied by an ordinary PR, merge-queue, or branch-push event.

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

These values give the queue enough time to collect bursts of small PRs while
keeping a single urgent PR from waiting too long.

## Developer Flow

1. Push a feature branch.
2. Open a PR to `main` (or `develop` for work targeting that branch).
3. Wait for path-aware PR CI.
4. When review and PR CI are green, comment `@mergifyio queue` for a normal
   `main` merge.
5. Mergify combines ready PRs and runs the full validation safety net on the
   candidate.
6. If validation passes, Mergify advances `main`; the resulting `main` push
   emits only its post-merge receipt.
7. If an environment needs new application images, an authorized operator
   explicitly dispatches **Release Deployment** with the full source SHA and
   successful CI run ID. `deploy=false` is valid when publication is needed
   without an IaC handoff.

No step in this flow publishes images or deploys an environment automatically.

## Failure Handling

If a queue candidate fails:

- Remove or reorder the suspected PR and requeue the remaining entries.
- Re-run the candidate if the failure is clearly transient.
- Split a large batch into smaller groups when the failing PR is not obvious.

Do not bypass the queue for normal feature work. Emergency merges should be
rare, still pass the applicable validation, and require a later explicit
Release Deployment if images or a non-production handoff are needed.

## Why Main Push Is Lightweight

Mergify has already validated the combined candidate before it moves `main`.
The post-merge `main` run records the resulting revision and performs only the
lightweight receipt work needed for visibility. It deliberately has no image
publication, deploy manifest, cloud authentication, Dataflow publication, or
Deploy Handoff path. The explicit Release Deployment workflow reruns reusable
CI validation on its selected exact SHA before publishing any selected images.
