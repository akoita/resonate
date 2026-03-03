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

### 2. Infrastructure-backed Tests

Functions that rely directly or indirectly on **real infrastructure** — database queries, file I/O, message queues, blockchain calls.

```bash
# Requires: make dev-up (Postgres, Redis, RabbitMQ, Anvil)
npm run test:integration
```

- Real Prisma + Postgres (no mocked Prisma)
- Real `LocalStorageProvider` file I/O
- Real Redis (via Testcontainers or `make dev-up`)
- Real Pub/Sub emulator
- Anvil for blockchain RPC (local Ethereum node via Docker)
- Skip gracefully when infra isn't running

### 3. E2E Tests

High-level scenarios from the perspective of a **human user or API consumer**.

```bash
npm run test:e2e                  # Backend E2E (future)
cd web && npm run test:e2e        # Frontend E2E (Playwright)
```

### 4. Orchestration Tests ⭐

**Highest value.** Multi-module scenarios covering event-driven flows and choreography.

Examples:

- Upload → BullMQ → Pub/Sub publish → worker → result → status=complete
- Mint NFT → IndexerService → marketplace listing
- User action → event → secondary module reacts → state propagates

```bash
npm run test:orchestration        # (future)
```

## Local Infrastructure

| Service        | Emulator                 | Setup                         |
| -------------- | ------------------------ | ----------------------------- |
| Postgres       | Native (Docker)          | `make dev-up` / CI service    |
| Redis          | Testcontainers or Docker | `make dev-up` / CI service    |
| Pub/Sub        | Google Pub/Sub emulator  | `docker run` or `make dev-up` |
| Blockchain RPC | **Anvil** (Foundry)      | `docker run` or `make dev-up` |
| File storage   | Real filesystem          | No setup needed               |

## Dual-Version Pattern (External Services)

For services that **cannot be emulated locally** (AI APIs, cloud billing):

```
service.spec.ts       ← Mocked version: always runs, uses test doubles
service.full.spec.ts  ← Full version: only runs when env is available
```

The mocked version validates logic and interface contracts.
The full version validates real integration — runs in staging/CI with credentials.

```typescript
// service.full.spec.ts
const API_KEY = process.env.VERTEX_AI_KEY;
const canRun = !!API_KEY;

describe("LyriaClient (full)", () => {
  beforeAll(() => {
    if (!canRun) {
      console.warn("⚠️  VERTEX_AI_KEY not set. Skipping full tests.");
    }
  });

  it("generates audio from Vertex AI", async () => {
    if (!canRun) return;
    // Real API call
  });
});
```

### Which services get dual versions?

| Service             | Mocked `.spec.ts` | Full `.full.spec.ts` | Why                    |
| ------------------- | ----------------- | -------------------- | ---------------------- |
| Vertex AI (Lyria)   | ✅                | ✅                   | Billable, rate-limited |
| Gemini (artwork)    | ✅                | ✅                   | Billable, rate-limited |
| GCS / Cloud Storage | ✅                | ✅                   | Billable               |
| Blockchain RPCs     | ❌ Use Anvil      | N/A                  | Anvil emulates locally |
| Pub/Sub             | ❌ Use emulator   | N/A                  | Emulator available     |
| Redis               | ❌ Use real       | N/A                  | Testcontainers/Docker  |

## When to Use Mocks

| Scenario            | Mock?             | Alternative                              |
| ------------------- | ----------------- | ---------------------------------------- |
| Postgres queries    | ❌ Never          | Real DB via `make dev-up` or CI services |
| Redis operations    | ❌ Never          | Testcontainers or Docker                 |
| Local file storage  | ❌ Never          | Real filesystem                          |
| Pub/Sub messaging   | ❌ Never          | Google Pub/Sub emulator                  |
| Blockchain RPCs     | ❌ Never          | Anvil (Foundry local node)               |
| Vertex AI / Gemini  | ✅ Mocked version | + `.full.spec.ts` when env available     |
| GCS / Cloud Storage | ✅ Mocked version | + `.full.spec.ts` when env available     |

## CI Pipeline

```
Lint ──┬── Logic Tests              (no infra, ~1m)
       ├── Infra-backed Tests       (Postgres + Redis + Anvil, ~3m)
       ├── Smart Contract Tests     (Foundry, ~45s)
       └── Build ── E2E Tests       (Playwright, ~2m)
```

## Naming Convention

```
*.spec.ts           — All backend tests (logic + infra-backed)
*.full.spec.ts      — Full external service tests (only with credentials)
*.e2e.spec.ts       — End-to-end API tests
*.orch.spec.ts      — Orchestration tests (multi-module flows)
*.test.ts           — Frontend tests (Vitest)
```

> Tests that need infrastructure skip gracefully when it's not running.
