# Testing Strategy

## Philosophy

**Zero-mock by default.** Testing tools have evolved enough that we can integrate real databases and infrastructure emulators without relying on mocks. Mocks hide complexity, mask underlying errors, and make the system's actual logic harder to maintain.

> Mock only what is **external and uncontrollable** (third-party APIs: GCS, Vertex AI, blockchain RPCs).
> Never mock what we **control** (Postgres, Redis, Pub/Sub emulator, local storage).

## Four Pillars

### 1. Logic Tests

Code that does **not** interact with infrastructure. Pure functions, state machines, parsers, validators.

```bash
# Examples: inferStemType, decodeAuthClaims, getChainConfig, formatDuration
npm test                          # Jest (backend)
npx vitest run                    # Vitest (frontend)
```

### 2. Infrastructure-backed Tests

Functions that rely directly or indirectly on **real infrastructure** — database queries, file I/O, message queues.

```bash
# Requires: make dev-up (Postgres, Redis, RabbitMQ)
npm run test:integration
```

- Use real Prisma + Postgres (no mocked prisma)
- Use real `LocalStorageProvider` file I/O
- Use real Redis connections
- Skip gracefully when infra isn't running

### 3. E2E Tests

High-level scenarios from the perspective of a **human user or API consumer**.

```bash
# Backend E2E: real HTTP requests against running server
npm run test:e2e                  # (future)

# Frontend E2E: Playwright browser automation
cd web && npm run test:e2e
```

### 4. Orchestration Tests ⭐

**Highest value.** Multi-module scenarios covering event-driven flows and choreography.

Examples:

- Upload file → BullMQ job → Pub/Sub publish → worker receives → result published → status=complete
- Mint NFT → IndexerService processes event → marketplace listing appears
- User action triggers event → secondary module reacts → state updates propagate

```bash
# Runs against full local stack
npm run test:orchestration        # (future)
```

## CI Pipeline

```
Lint ──┬── Logic Tests              (fast, no infra, ~1m)
       ├── Infra-backed Tests       (Postgres + Redis, ~3m)
       ├── Smart Contract Tests     (Foundry, ~45s)
       └── Build ── E2E Tests       (Playwright, ~2m)
```

## When to Use Mocks

| Scenario            | Mock?  | Why                                          |
| ------------------- | ------ | -------------------------------------------- |
| Postgres queries    | ❌ No  | Use real DB via `make dev-up` or CI services |
| Redis operations    | ❌ No  | Use real Redis                               |
| Local file storage  | ❌ No  | Use real filesystem                          |
| Pub/Sub messaging   | ❌ No  | Use emulator                                 |
| GCS / Cloud Storage | ✅ Yes | External, billable                           |
| Vertex AI / Gemini  | ✅ Yes | External, billable, rate-limited             |
| Blockchain RPCs     | ✅ Yes | External, non-deterministic                  |

## Naming Convention

```
*.spec.ts           — Logic tests (pure functions)
*.infra.spec.ts     — Infrastructure-backed tests (real DB/storage)
*.e2e.spec.ts       — End-to-end API tests
*.orch.spec.ts      — Orchestration tests (multi-module flows)
```
