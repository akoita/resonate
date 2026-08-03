# Resonate Backend — Testing Standards

> Loaded when working under `backend/`. Project-wide rules live in the root
> [AGENTS.md](../AGENTS.md). As at the repo root, `CLAUDE.md` here is a symlink
> to this file.


Backend tests use **Testcontainers** to spin up real infrastructure in Docker. No manual `make dev-up` required — only a Docker daemon.

## File Naming

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

## Rules

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

