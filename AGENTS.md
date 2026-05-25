# Resonate — AI Agent Coding Standards

> This file is read by AI coding assistants (GitHub Copilot, Gemini Code Assist, Claude, etc.)
> to enforce project-wide conventions. Keep it up to date.

## 🚨 No Hardcoded Configuration Values

**NEVER hardcode** URLs, ports, secrets, API keys, project IDs, bucket names, or any
environment-dependent values directly in source code.

### Rules

1. **Always use environment variables** with a sensible local-dev fallback:

   ```typescript
   // ✅ CORRECT
   const url = process.env.BACKEND_URL || "http://localhost:3000";

   // ❌ WRONG — hardcoded production/staging URL
   const url = "https://my-service-XXXXX.region.run.app";

   // ❌ WRONG — no env var at all
   const url = "http://localhost:3001/encryption/decrypt";
   ```

2. **Use centralized constants** — don't redeclare `API_BASE` in every file:

   ```typescript
   // ✅ Import from the canonical source
   import { API_BASE } from "@/lib/api";

   // ❌ Don't redeclare per-file
   const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
   ```

3. **Port conventions** — local dev defaults must use the correct port:
   - Backend (NestJS): `3000`
   - Frontend (Next.js): `3001`
   - Demucs Worker: `8000`
   - Anvil (local chain): `8545`
   - AA Bundler: `4337`

4. **Never commit secrets** — API keys, JWT secrets, private keys, and service account
   credentials must come from environment variables or secret managers, never from source.

### Environment Variable Naming

| Layer              | Prefix         | Example                                |
| ------------------ | -------------- | -------------------------------------- |
| Frontend (browser) | `NEXT_PUBLIC_` | `NEXT_PUBLIC_API_URL`                  |
| Frontend (server)  | none           | `BACKEND_URL`                          |
| Backend            | none           | `STORAGE_PROVIDER`, `GCS_STEMS_BUCKET` |

### Required Environment Variables

Document any new app env var in `docs/deployment/environment.md` and the
relevant deploy configuration in `resonate-iac`. Keep
`docs/smart-contracts/deployment.md` focused on contract deployment and
contract-adjacent local workflows.

---

## 📚 Feature Catalog & Documentation Updates

`docs/features/README.md` is the canonical human-readable catalog of Resonate
features. Developers and agents should be able to discover what exists, what is
partial/planned/retired, who it is for, and how to use or test it without
reading the whole codebase.

### Rules

1. **Update the feature catalog for durable feature work.** When adding,
   materially changing, exposing, hiding, or removing a user-facing,
   developer-facing, API-facing, agent-facing, or protocol-facing feature:
   - Update `docs/features/README.md`
   - Add or update the feature's dedicated page under `docs/features/`

2. **Feature pages must be practical.** A feature page should include:
   - current status (`implemented`, `partial`, `in-progress`, `planned`, or `retired`)
   - who the feature is for
   - what value it provides
   - how to use it as an end user, developer, or agent/API consumer
   - relevant UI routes, API endpoints, env vars, events, services, and tests
   - links to deeper RFCs, architecture docs, issues, PRs, and code references

3. **Keep RFCs and feature docs distinct.**
   - RFCs explain design intent, alternatives, and future architecture.
   - Feature pages explain the current product/platform capability and how to
     use or verify it today.

4. **Update docs in the same branch as code.** Do not leave feature catalog
   updates for a later cleanup PR unless the user explicitly scopes the work to
   code only.

5. **Use `/finish-issue` to enforce this.** The finish workflow includes the
   feature catalog check alongside security scans, tests, commits, and PR work.

---

## 🚨 Git Workflow — Branch & PR Only

**NEVER push directly to `main`.** All changes must go through a feature branch and Pull Request.

### Rules

1. **Always work on a branch** — use the naming conventions:
   - `feat/<issue-number>-<short-description>` for features
   - `fix/<issue-number>-<short-description>` for bug fixes
   - `docs/<issue-number>-<short-description>` for documentation

2. **Submit a Pull Request** targeting `main` — include a clear description and reference the issue (`Closes #N`).

3. **Merge only on explicit developer request** — never merge a PR autonomously. Wait for the developer to say "merge", "you can merge", or equivalent.

4. **Never force-push to `main`** — only force-push on feature branches if absolutely necessary.

5. **Clean up after merge** — delete the feature branch (local + remote) and align local `main`.

6. **Use the `/start-issue` workflow** when beginning work on any issue or task (features, fixes, improvements, etc.). Run the steps in `.agents/workflows/start-issue.md` to create the branch, track work, and open the PR scaffold.

7. **Use the `/finish-issue` workflow** when completing work on an issue. Run the steps in `.agents/workflows/finish-issue.md` to verify, test, commit, push, create PR, merge, and clean up. This ensures security scans are executed and no steps are skipped.

---

## Architecture Conventions

### Backend (NestJS)

- Storage provider is selected by `STORAGE_PROVIDER` env var (`gcs`, `ipfs`, `local`)
- BullMQ workers run in the same process (Cloud Run `minScale=1, cpu-throttling=false`)
- Redis connection via `REDIS_HOST` / `REDIS_PORT` (Memorystore in prod)

### Frontend (Next.js)

- API base URL: `NEXT_PUBLIC_API_URL` → defaults to `http://localhost:3001`
- WebSocket URL: same as API URL (Socket.IO on same backend)
- Chain config: `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`

### Deployment

- Cloud Run in `europe-west1`
- Terraform manages infrastructure (`infra/terraform/`)
- `make deploy-backend ENV=dev` / `make deploy-frontend ENV=dev` for deployments

---

## 🧪 Testing Standards — Testcontainers First

Backend tests use **Testcontainers** to spin up real infrastructure in Docker. No manual `make dev-up` required — only a Docker daemon.

### File Naming

| Pattern                     | Purpose                                                         | Runner                       |
| --------------------------- | --------------------------------------------------------------- | ---------------------------- |
| `*.spec.ts`                 | Pure unit tests — no DB, no containers, no Prisma               | `npm run test`               |
| `*.controller.spec.ts`      | Controller unit tests — mock service, test logic/shaping        | `npm run test`               |
| `*.controller.http.spec.ts` | Controller HTTP contract — routing, guards, status codes        | `npm run test`               |
| `*.integration.spec.ts`     | Tests against real containers (Postgres, Redis, Anvil, Pub/Sub) | `npm run test:integration`   |
| `*.external.spec.ts`        | External service tests — only with cloud credentials            | manual / staging CI          |
| `*.flow.spec.ts`            | Multi-module event-driven flow tests                            | `npm run test:flow` (future) |
| `*.test.ts`                 | Frontend tests (Vitest)                                         | `npx vitest run`             |

All backend test files live in `backend/src/tests/`. See `backend/TESTING.md` for the full strategy.

### Rules

1. **Never mock Prisma.** If a service uses `prisma`, write an `.integration.spec.ts` that runs against the real Testcontainer Postgres. Use the global `prisma` singleton from `../db/prisma` — the Testcontainer setup handles the `DATABASE_URL`.

   ```typescript
   // ✅ CORRECT — import real prisma
   import { prisma } from "../db/prisma";

   // ❌ WRONG — never do this
   jest.mock("../db/prisma", () => ({
     prisma: { track: { findMany: jest.fn() } },
   }));
   ```

2. **Seed with unique prefixes.** Every integration test must use a unique `TEST_PREFIX` to avoid collisions with parallel tests:

   ```typescript
   const TEST_PREFIX = `mytest_${Date.now()}_`;
   // Seed: User → Artist → Release → Track (respect FK chain)
   beforeAll(async () => {
     await prisma.user.create({
       data: {
         id: `${TEST_PREFIX}user`,
         email: `${TEST_PREFIX}@test.resonate`,
       },
     });
     // ... seed rest of FK chain
   });
   // Clean up in reverse FK order
   afterAll(async () => {
     /* delete in reverse order */
   });
   ```

3. **External services stay mocked.** Services that require external infrastructure not available as a Testcontainer (Google AI, Lyria, bundlers like Pimlico/Alto) should be mocked. Common allowed mocks:
   - `@google/genai`, `@google/adk` — AI SDK (ESM packages)
   - `google-auth-library` — Google Cloud auth
   - `fetch` for external APIs (Vertex AI, bundlers) — but NOT for Anvil-reachable endpoints
   - BullMQ queue — job scheduling internals
   - Storage provider — when not testing storage itself

4. **Use dockerized Anvil for blockchain.** The Testcontainer Anvil is available at `process.env.ANVIL_RPC_URL`. Use it for:
   - ERC-4337 client tests (real JSON-RPC transport)
   - Indexer tests (real block reading)
   - Any contract interaction test

5. **Use Pub/Sub emulator for messaging.** Available at `process.env.PUBSUB_EMULATOR_HOST` with project ID `resonate-local`.

### Available Containers (via `globalSetup.js`)

| Container        | Module                       | Env Var                    |
| ---------------- | ---------------------------- | -------------------------- |
| Postgres 16      | `@testcontainers/postgresql` | `DATABASE_URL`             |
| Redis 7          | `@testcontainers/redis`      | `REDIS_HOST`, `REDIS_PORT` |
| Anvil (Foundry)  | `GenericContainer`           | `ANVIL_RPC_URL`            |
| Pub/Sub emulator | `GenericContainer`           | `PUBSUB_EMULATOR_HOST`     |

### Running Tests

```bash
# Integration tests (starts 4 containers, ~30s startup)
cd backend && npm run test:integration

# Unit tests only (instant, no Docker)
cd backend && npm run test

# Single integration file
npx jest --runInBand --config jest.integration.config.js --testPathPattern='catalog.integration'
```

---

## 🔐 Smart Contract Testing & Verification Standards

Smart contracts are asset-custody and protocol-truth code. Treat every contract
change as security-sensitive, even when the change looks small.

### Deployment Key Safety

Forge scripts that broadcast transactions must never silently use the default
Anvil private key on a remote/non-local RPC. Use the shared deployment-key
helper in `contracts/script/DeploymentKey.s.sol` for every deploy, upgrade, or
admin-update script.

- Remote environments (`dev`, `staging`, `test`, `prod`, or any shared RPC)
  must provide an explicit `PRIVATE_KEY` / `CONTRACT_DEPLOYER_PRIVATE_KEY`.
- The default Anvil key is acceptable only for local chains or when a local/fork
  command explicitly sets `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY=true`.
- Do not set `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY` in GitHub deployment
  environments.
- If a script needs a different signer model, document it in
  `docs/smart-contracts/deployment.md` before wiring it into CI.

### Deployment Output Handoffs

Every deploy script that creates or changes an address-bearing contract must
produce machine-readable handoff files under `contracts/deployments/` before it
is considered CI/deploy ready:

- a JSON deployment record with network, chain ID, deployer, owner/admin when
  relevant, contract addresses, transaction hash, broadcast path, artifact path,
  ABI path, and ABI hash;
- a `.remote.env` handoff containing only non-secret app/runtime variables that
  `resonate-iac`, GitHub environments, GCP Secret Manager, or Cloud Run config
  need to consume;
- an ABI handoff, or a documented generated ABI module, for any app-side code
  that submits calls, decodes events, or validates contract data.

Never make app deployment depend on copied console output. If an existing
contract deploy path only uploads raw Foundry broadcasts, improve it to follow
this pattern before adding more downstream automation.

### Required Test Ladder

Use the strongest practical layer for the risk of the change. Do not rely on
happy-path unit tests alone for contracts that hold funds, gate authority, route
payments, enforce royalties, or control upgrades.

| Layer | Required When | Runner / Tool |
| --- | --- | --- |
| Unit tests | Every Solidity behavior change | `cd contracts && forge test --match-path test/unit/...` |
| Fuzz/property tests | Any function with numeric bounds, authorization branching, accounting, transfers, mint/list/buy flows, or non-trivial input space | Foundry fuzz tests in `contracts/test/fuzz/` |
| Invariant tests | Any stateful protocol, escrow, marketplace, token supply, role/permission, or multi-step lifecycle | Foundry invariant tests in `contracts/test/invariant/` |
| Symbolic/formal tests | Asset custody, release/refund logic, upgrade authorization, royalty/payment conservation, or subtle state-machine rules | Halmos/Kontrol/Certora Prover, or a documented deferral |
| Mutation testing | High-value contracts, new formal specs, or contract suites where test strength is uncertain | Certora Gambit, or a documented deferral |
| Static/security scan | Before PR completion for material contract changes | Existing `/finish-issue` smart-contract scan workflow |

For a new contract that holds or routes funds, the default expectation is:

- unit tests for all lifecycle transitions and access-control failures;
- fuzz/property tests for amount, deadline, basis-point, and boundary behavior;
- invariant tests for conservation of funds and impossible state transitions;
- symbolic/formal tests for at least the core safety property, or an explicit
  note explaining why formal coverage is deferred.
- mutation testing for high-value escrow/marketplace/payment contracts before
  production launch, or an explicit note explaining why it is deferred.

### Preferred Maintained Tools

Prefer tools with active maintenance and real adoption:

- **Foundry** for unit, fuzz, invariant, fork, and gas testing:
  <https://book.getfoundry.sh/>
- **Halmos** for symbolic testing from Foundry-style Solidity tests:
  <https://github.com/a16z/halmos>
- **Kontrol** for Foundry-compatible formal verification on KEVM:
  <https://docs.runtimeverification.com/kontrol>
- **Certora Prover** for high-assurance CVL specifications on critical
  economic/security properties:
  <https://docs.certora.com/en/latest/docs/prover/index.html>
- **Certora Gambit** for Solidity mutation testing, especially to evaluate
  whether tests or CVL specs catch intentionally injected logic faults:
  <https://docs.certora.com/en/latest/docs/gambit/index.html>
- **Echidna** and **Medusa** from Crytic/Trail of Bits for long-running
  property fuzzing campaigns when Foundry fuzzing is not enough:
  <https://github.com/crytic/echidna> and <https://github.com/crytic/medusa>

Avoid adopting unmaintained or research-only tools as required project gates.
They can be useful for experiments, but not as the main standard.

### Shared Contract Surfaces

When errors, events, enums, structs, or core function signatures are consumed by
tests, indexers, backend code, or frontend code, put the shared surface in an
interface under `contracts/src/interfaces/` and import it from both production
contracts and tests.

Examples:

- `IShowCampaignEscrow` owns `CampaignStatus`, `Campaign`, custom errors, and
  events.
- `ShowCampaignEscrow` implements/imports that interface.
- Tests import the same interface for `expectRevert` selectors and
  `expectEmit` declarations.

This prevents tests from silently duplicating event/error declarations that later
drift from production.

### Test Directory Conventions

Keep Solidity tests organized by verification layer:

- `contracts/test/unit/` for deterministic examples and access-control cases;
- `contracts/test/fuzz/` for Foundry property tests over dynamic inputs;
- `contracts/test/invariant/` for stateful handler-based invariant suites;
- `contracts/test/formal/` for Halmos/Kontrol-compatible symbolic tests;
- `contracts/certora/conf/` and `contracts/certora/specs/` for Certora Prover
  configuration and CVL specs.

Name files by contract or protocol surface, for example
`ShowCampaignEscrow.fuzz.t.sol`, `ShowCampaignEscrow.invariant.t.sol`, and
`ShowCampaignEscrow.formal.t.sol`. Keep handlers and mocks close to the layer
that uses them unless they are reused across several suites.

### Custom Error Context

Prefer Solidity custom errors over revert strings. Add parameters when they help
identify the failing object, actor, bound, expected value, or actual value.

Good examples:

```solidity
error InvalidCampaignStatus(uint256 campaignId, CampaignStatus current, CampaignStatus expected);
error DepositReleaseTooHigh(uint256 requestedBps, uint256 maxBps);
error UnauthorizedConfirmer(address caller);
error InsufficientPledge(uint256 campaignId, address backer, uint256 amount);
```

Do not add parameters mechanically. Keep parameterless errors for obvious local
preconditions where context adds noise, such as `ZeroAmount()` or
`ZeroAddress()`. Avoid large dynamic data in errors.

### Required Documentation

When a contract introduces or changes durable protocol behavior:

- update `contracts/README.md` and relevant `docs/smart-contracts/*` pages;
- update feature docs if the contract changes a product-facing capability;
- document any omitted fuzz, invariant, or formal layer in the PR summary or
  feature plan.

---

## Code Quality

- Run `npm run lint` in both `backend/` and `web/` before committing
- Prisma schema changes require `npx prisma generate` and migration
- Use `window.confirm()` sparingly — prefer `ConfirmDialog` React component for UX consistency
- Test files go in `backend/src/tests/` — use `.integration.spec.ts` for DB-dependent tests, `.controller.http.spec.ts` for HTTP contract tests, `.spec.ts` for pure unit tests
