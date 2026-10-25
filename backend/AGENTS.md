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

1. **Keep Prisma artifacts current.** Prisma schema changes require a migration
   and `npx prisma generate`. Do not hand-edit generated Prisma artifacts.

2. **Never mock Prisma.** If a service uses `prisma`, write an `.integration.spec.ts` that runs against the real Testcontainer Postgres. Use the global `prisma` singleton from `../db/prisma` — the Testcontainer setup handles the `DATABASE_URL`.

   ```typescript
   // ✅ CORRECT — import real prisma
   import { prisma } from "../db/prisma";

   // ❌ WRONG — never do this
   jest.mock("../db/prisma", () => ({
     prisma: { track: { findMany: jest.fn() } },
   }));
   ```

3. **Seed with unique prefixes.** Every integration test must use a unique `TEST_PREFIX` to avoid collisions with parallel tests:

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

   **Cleanup is scoped to rows the suite created.** Suites run in parallel against
   one shared database, so never `deleteMany({})` / `deleteMany()` (or `TRUNCATE`,
   or `DELETE FROM` without `WHERE`) in an integration spec: scope every delete by
   the test prefix, collected ids, or a chain id the suite owns. Destructive
   service paths (for example the indexer's chain-reset purge) are exercised on a
   chain id no other suite uses, not the shared `31337`.
   `src/tests/integration_cleanup_scope_guard.spec.ts` fails on unscoped wipes.

4. **External services stay mocked.** Services that require external infrastructure not available as a Testcontainer (Google AI, Lyria, bundlers like Pimlico/Alto) should be mocked. Common allowed mocks:
   - `@google/genai`, `@google/adk` — AI SDK (ESM packages)
   - `google-auth-library` — Google Cloud auth
   - `fetch` for external APIs (Vertex AI, bundlers) — but NOT for Anvil-reachable endpoints
   - BullMQ queue — job scheduling internals
   - Storage provider — when not testing storage itself

5. **Use dockerized Anvil for blockchain.** The Testcontainer Anvil is available at `process.env.ANVIL_RPC_URL`. Use it for:
   - ERC-4337 client tests (real JSON-RPC transport)
   - Indexer tests (real block reading)
   - Any contract interaction test

6. **Use Pub/Sub emulator for messaging.** Available at `process.env.PUBSUB_EMULATOR_HOST` with project ID `resonate-local`.

7. **Controller HTTP apps mirror production validation.** `main.ts` registers the
   global `ValidationPipe` from `src/config/validation.ts` (#1888), and
   `createControllerTestApp` in `src/tests/e2e-helpers.ts` applies the same pipe.
   Any spec that builds its own app with `createNestApplication()` must call
   `applyGlobalValidation(app)` too. The pipe enforces class-validator decorators
   on class DTOs only (no whitelist, no transform); interface-typed bodies are not
   validated by it, so their services must validate input. Cover new DTO
   constraints with `400` cases in the matching `*.controller.http.spec.ts`.
   New request bodies use class DTOs (#1890). The `@Body()` type must be the
   class itself: an intersection or inline type compiles to `Object` and is
   skipped. A route that authenticates inside the handler (an internal-key
   header, for example) validates its body inline after that check, because a
   DTO would answer `400` before the caller is authenticated.
   `src/tests/body_dto_guard.spec.ts` fails when a whole-body `@Body()` is not a
   class and not allowlisted with a reason; the decision and the module-by-module
   inventory are in `docs/engineering/request-body-validation.md` (#2197).

8. **Controller HTTP apps mirror production guards.** `createControllerTestApp`
   in `src/tests/e2e-helpers.ts` registers the global `RolesGuard` exactly as
   `app.module.ts` does. `@Roles(...)` routes must authenticate with
   `AuthGuard("jwt")`; the global guard verifies the JWT itself because Nest runs
   global guards before route guards, and a reflection spec fails if a `@Roles`
   route uses a different auth guard. Test each role-restricted route with an
   under-privileged token and expect `403`.

9. **Destructive admin routes carry `@RequireStepUp()` (#2173).** The global
   `AdminStepUpGuard` (registered by `createControllerTestApp` as in
   `app.module.ts`) answers `403 { code: "step_up_required" | "step_up_expired" |
   "step_up_invalid" }` without a fresh `X-Admin-Step-Up` proof. Mint one in a
   spec with `stepUpProof(userId)` from `e2e-helpers`, and cover the missing,
   stale and fresh cases. A new route gated this way also goes in the pinned list
   in `admin_step_up_routes.spec.ts`, and an admin action writes one
   `writeAdminAuditEvent` record.
   Every other admin or operator route is recorded with `@AdminAudit(action,
   describe)` (`admin_audit.interceptor.ts`; #2362): the action name goes in
   `ADMIN_AUDIT_ACTIONS`, and the describer reads ids, codes and counts through
   `auditRef` / `auditCode` / `auditNumber`, never operator-typed text.
   `admin_audit_coverage.spec.ts` fails for an `admin` or `operator` route with
   neither `@AdminAudit` nor a listed reason; specs of audited controllers mock
   `writeAdminAuditEvent` (see `credits.controller.http.spec.ts`) and use
   `confirmedBearer` / `expectStepUpRequired` from `e2e-helpers` for gated routes.
