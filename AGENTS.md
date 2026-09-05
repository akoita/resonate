# Resonate agent instructions

This is the canonical project policy. `CLAUDE.md` links to this file; do not
maintain a second copy. Paths below are relative to the repository root.

## Working process

- Follow [start-issue](.agents/workflows/start-issue.md) for every task and
  [finish-issue](.agents/workflows/finish-issue.md) when finalizing it.
- Work on a feature branch, never commit or push directly to `main`, and never
  force-push to `main`. Reuse the branch for related follow-ups.
- Use `feat/<issue>-<description>`, `fix/<issue>-<description>`, or
  `docs/<issue>-<description>`; omit the issue segment when there is no issue.
- Complete local implementation and validation before requesting publication
  approval. Honor approval already given in the conversation; do not ask again.
- Merge only on an explicit user request. Finishing prepares the PR; it does
  not authorize merging, deployment, or branch cleanup. Clean up merged branches
  and align local `main` only after merge.
- Preserve unrelated work. Use an isolated worktree if switching branches would
  disturb it; do not automatically stash or commit someone else's changes.
- Use Linux/macOS shells, or WSL on Windows. Machine-specific hooks and personal
  tool configuration belong in ignored local settings.

## Read the applicable rules before editing

These linked rules are mandatory when their scope applies, including changes
outside a directory that affect its behavior. Read only the relevant material.

| Scope | Required guidance |
| --- | --- |
| Backend tests, persistence, infrastructure test fixtures | [Backend testing](.agents/rules/backend-testing.md), [backend/TESTING.md](backend/TESTING.md) |
| Solidity, contract tests, deploy/upgrade scripts, ABI handoffs | [Smart contract standards](.agents/rules/contracts.md) |
| Money, fees, payouts, upload trust, generation billing, collectibles, licensing | [Business model](.agents/rules/business-model.md) |
| Durable features, user-visible behavior, partial delivery, documentation | [Documentation and feature completion](.agents/rules/documentation.md) |
| Durable product, API, backend, frontend, analytics, protocol, deployment work | [Change impact checklist](docs/engineering/change_impact_checklist.md) |

Never ship a silent partial feature: record remaining work in an issue or plan,
mark the capability partial, and distinguish shipped behavior from deferred work.
Do not close a parent feature until it is usable end to end.

## Configuration and architecture

Never embed environment-dependent URLs, ports, project IDs, buckets, or secrets
in source. Use environment variables and safe local defaults, with centralized
constants rather than per-file declarations.

- Frontend API calls import `API_BASE` from `@/lib/api`. Its environment variable
  is `NEXT_PUBLIC_API_URL`, with local fallback `http://localhost:3000`.
- Browser variables use `NEXT_PUBLIC_`; server variables do not. Never expose
  secrets through browser variables. Server API URLs use `BACKEND_URL`.
- Local ports: backend `3000`, frontend `3001`, Demucs `8000`, Anvil `8545`,
  AA bundler `4337`. These are local defaults, not production configuration.
- WebSockets use the backend API URL. Chain configuration uses
  `NEXT_PUBLIC_CHAIN_ID` and `NEXT_PUBLIC_RPC_URL`.
- Storage uses `STORAGE_PROVIDER` (`gcs`, `ipfs`, `local`); Redis uses
  `REDIS_HOST` / `REDIS_PORT`. BullMQ workers run in the backend process.
- Document new app variables in [environment.md](docs/deployment/environment.md)
  and update the relevant configuration in `resonate-iac`. Contract deployment
  guidance belongs in [smart-contract deployment](docs/smart-contracts/deployment.md).
- Follow [deployment architecture](docs/architecture/deployment_architecture.md)
  for infrastructure ownership and Cloud Run configuration; verify the target
  environment before deployment.
- Never commit credentials, private data, local overrides, generated build
  output, or dependency directories. Ignoring an already tracked secret does
  not remove it from Git history.

## Implementation and validation

- Use focused tests and lint/type checks for the changed behavior; choose gates
  using [finish-issue](.agents/workflows/finish-issue.md). Documentation-only
  changes need link/command checks and `git diff --check`, not application suites.
- Never mock Prisma. Database-dependent tests use real Testcontainers and the
  shared Prisma singleton; external services remain mocked.
- Prisma schema changes require a migration and `npx prisma generate`.
- Treat every contract change as security-sensitive and apply the contract test
  ladder. General validation budgets do not waive required security coverage.
- Prefer the shared `ConfirmDialog` component over `window.confirm()`.
- Update current feature docs and architecture alongside behavior. User-visible
  changes also update the `/help` guide and its content-integrity test.
- Write documentation for human readers: useful sections, one coherent point
  per paragraph, current information, and links instead of duplicated detail.
  Restructure paragraphs or list items longer than about 120 words.

## Skills and workflows

See [.agents/README.md](.agents/README.md) for workflow discovery, skill ownership,
and maintenance. Installed skills supplement these rules; do not copy their
implementation or machine-specific installation paths into this repository.
