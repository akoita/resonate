# Testing Strategy

## Philosophy

**Zero-mock by default.** Testing tools have evolved enough that we can integrate real databases, infrastructure emulators, and local nodes without relying on mocks. Mocks hide complexity, mask underlying errors, and make the system's actual logic harder to maintain.

> Mock only what is **truly external and cannot be emulated locally** (Vertex AI, Gemini, GCS).
> Emulate everything else: Postgres, Redis, Pub/Sub, blockchain RPC.

## Four Pillars

### 1. Logic Tests

Code that does **not** interact with infrastructure. Pure functions, state machines, parsers, validators.

```bash
npm test                          # Jest (backend)
npx vitest run                    # Vitest (frontend)
```

### 1b. Controller Tests (Two-Layer Strategy)

Controllers have their own constraints that can only be tested directly — a service can be correct but the controller exposing it can still break the feature. We test controllers with **two complementary layers**, avoiding duplication with service tests:

| Layer    | File pattern                | Tooling                                  | Focus                                         |
| -------- | --------------------------- | ---------------------------------------- | --------------------------------------------- |
| **Unit** | `*.controller.spec.ts`      | `new Controller(mockService)`            | Logic, method calls, arg transformations      |
| **HTTP** | `*.controller.http.spec.ts` | `Test.createTestingModule` + `supertest` | Routing, HTTP status codes, guard enforcement |

**Unit tests** mock the service and test only what the controller adds:

- Request parsing (JSON string → object, range headers, limit NaN fallback)
- Controller-level branching (auth verify 5-path flow)
- Error wrapping (`try/catch` → `{ status: "error" }`)
- Response shaping (userId extraction, BigInt conversions)

**HTTP tests** use a lightweight NestJS test module (no Docker, no DB) and test the HTTP contract:

- Route correctness (`POST /auth/verify` → 201)
- Guard enforcement (no JWT → 401)
- Response headers (`Content-Type`, `Accept-Ranges`)
- 404 on missing resources

Shared helper: `e2e-helpers.ts` provides `authToken()` and `createControllerTestApp()` for consistent JWT + app setup across all HTTP tests.

```typescript
// HTTP test example
const app = await createControllerTestApp(CatalogController, [
  { provide: CatalogService, useValue: mockService },
]);
await request(app.getHttpServer()).get("/catalog/me").expect(401); // no JWT → guard blocks
await request(app.getHttpServer())
  .get("/catalog/me")
  .set("Authorization", `Bearer ${authToken("user-1")}`)
  .expect(200); // valid JWT → success
```

### 2. Integration Tests (`.integration.spec.ts`)

Service-level tests that rely on **real infrastructure** — database queries, file I/O, message queues, blockchain calls.

```bash
# Requires: Docker for Testcontainers, or an equivalent local stack from resonate-iac
npm run test:integration
```

- Real Prisma + Postgres (no mocked Prisma)
- Real `LocalStorageProvider` file I/O
- Real Redis (via Testcontainers or a local `resonate-iac` stack)
- Real Pub/Sub emulator
- Anvil for blockchain RPC (local Ethereum node via Docker)
- Skip gracefully when infra isn't running

### 3. E2E Tests

High-level scenarios from the perspective of a **human user or API consumer**.

```bash
npm run test:e2e                  # Backend E2E (future)
cd web && npm run test:e2e        # Frontend E2E (Playwright)
```

### 4. Flow Tests ⭐

**Highest value.** Multi-module scenarios covering event-driven flows and choreography.

Examples:

- Upload → BullMQ → Pub/Sub publish → worker → result → status=complete
- Mint NFT → IndexerService → marketplace listing
- User action → event → secondary module reacts → state propagates

```bash
npm run test:flow                 # (future)
```

## Local Infrastructure

| Service        | Emulator                 | Setup                         |
| -------------- | ------------------------ | ----------------------------- |
| Postgres       | Native (Docker)          | Testcontainers / `resonate-iac` / CI service |
| Redis          | Testcontainers or Docker | Testcontainers / `resonate-iac` / CI service |
| Pub/Sub        | Google Pub/Sub emulator  | `docker run` or `resonate-iac` |
| Blockchain RPC | **Anvil** (Foundry)      | `docker run` or `resonate-iac` |
| File storage   | Real filesystem          | No setup needed               |

## Dual-Version Pattern (External Services)

For services that **cannot be emulated locally** (AI APIs, cloud billing):

```
service.spec.ts           ← Mocked version: always runs, uses test doubles
service.external.spec.ts  ← Full version: only runs when env is available
```

The mocked version validates logic and interface contracts.
The full version validates real integration — runs in staging/CI with credentials.

```typescript
// service.external.spec.ts
const API_KEY = process.env.VERTEX_AI_KEY;
const canRun = !!API_KEY;

describe("LyriaClient (external)", () => {
  beforeAll(() => {
    if (!canRun) {
      console.warn("⚠️  VERTEX_AI_KEY not set. Skipping external tests.");
    }
  });

  it("generates audio from Vertex AI", async () => {
    if (!canRun) return;
    // Real API call
  });
});
```

### Which services get dual versions?

| Service             | Mocked `.spec.ts` | External `.external.spec.ts` | Why                    |
| ------------------- | ----------------- | ---------------------------- | ---------------------- |
| Vertex AI (Lyria)   | ✅                | ✅                           | Billable, rate-limited |
| Gemini (artwork)    | ✅                | ✅                           | Billable, rate-limited |
| GCS / Cloud Storage | ✅                | ✅                           | Billable               |
| Blockchain RPCs     | ❌ Use Anvil      | N/A                          | Anvil emulates locally |
| Pub/Sub             | ❌ Use emulator   | N/A                          | Emulator available     |
| Redis               | ❌ Use real       | N/A                          | Testcontainers/Docker  |

## When to Use Mocks

| Scenario            | Mock?             | Alternative                              |
| ------------------- | ----------------- | ---------------------------------------- |
| Postgres queries    | ❌ Never          | Real DB via Testcontainers, `resonate-iac`, or CI services |
| Redis operations    | ❌ Never          | Testcontainers or Docker                 |
| Local file storage  | ❌ Never          | Real filesystem                          |
| Pub/Sub messaging   | ❌ Never          | Google Pub/Sub emulator                  |
| Blockchain RPCs     | ❌ Never          | Anvil (Foundry local node)               |
| Vertex AI / Gemini  | ✅ Mocked version | + `.external.spec.ts` when env available |
| GCS / Cloud Storage | ✅ Mocked version | + `.external.spec.ts` when env available |

## CI Pipeline

```
Lint ──┬── Logic Tests              (no infra, ~1m)
       ├── Integration Tests        (Postgres + Redis + Anvil, ~3m)
       ├── Smart Contract Tests     (Foundry, ~45s)
       └── Build ── E2E Tests       (Playwright, ~2m)
```

## Naming Convention

```
*.spec.ts                    — Service/logic tests (no infra)
*.controller.spec.ts         — Controller unit tests (mock service, test logic)
*.controller.http.spec.ts    — Controller HTTP tests (Test.createTestingModule + supertest)
*.integration.spec.ts        — Integration tests (DB, Redis, Anvil — real infra)
*.external.spec.ts           — External service tests (only with cloud credentials)
*.e2e.spec.ts                — End-to-end API tests
*.flow.spec.ts               — Flow tests (multi-module event-driven scenarios)
*.test.ts                    — Frontend tests (Vitest)
```

> Tests that need infrastructure skip gracefully when it's not running.
