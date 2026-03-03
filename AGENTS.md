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

Document any new env var in `docs/smart-contracts/deployment.md` and the relevant Terraform config
(`infra/terraform/backend-service.tf` or `infra/terraform/frontend-service.tf`).

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

| Pattern                 | Purpose                                                         | Runner                     |
| ----------------------- | --------------------------------------------------------------- | -------------------------- |
| `*.integration.spec.ts` | Tests against real containers (Postgres, Redis, Anvil, Pub/Sub) | `npm run test:integration` |
| `*.spec.ts`             | Pure unit tests — no DB, no containers, no Prisma               | `npm run test`             |

All test files live in `backend/src/tests/`.

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

## Code Quality

- Run `npm run lint` in both `backend/` and `web/` before committing
- Prisma schema changes require `npx prisma generate` and migration
- Use `window.confirm()` sparingly — prefer `ConfirmDialog` React component for UX consistency
- Test files go in `backend/src/tests/` — use `.integration.spec.ts` for DB-dependent tests, `.spec.ts` for pure unit tests
