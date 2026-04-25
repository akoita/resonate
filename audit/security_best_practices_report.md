# Security Best Practices Report

## Executive Summary

Reviewed the pgvector-backed embedding store work on
`feat/627-pgvector-embedding-store`. No Critical or High findings were
identified in the changed backend code.

## Scope

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260425223000_add_track_embeddings_pgvector/migration.sql`
- `backend/src/modules/embeddings/embedding.store.ts`
- `backend/src/modules/agents/tools/tool_registry.ts`
- `backend/src/tests/embeddings.spec.ts`
- `backend/src/tests/embeddings.integration.spec.ts`
- `backend/src/tests/globalSetup.js`
- `.github/workflows/ci.yml`
- Related documentation update in `docs/rfc/agent-opportunities-2026-04.md`

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None in the changed code.

## Low Findings

None in the changed code.

## Informational Notes

- The new raw SQL in `EmbeddingStore` uses Prisma tagged template queries, not
  string-concatenated SQL.
- Vector literals are built only after validating fixed dimension and finite
  numeric values.
- Candidate IDs are passed through `Prisma.join(...)` inside a parameterized
  query.
- The integration test Postgres image changed from `postgres:16` to
  `pgvector/pgvector:pg16`, and the E2E CI Postgres service uses the same image,
  so test schema sync can exercise the extension the migration enables.
- Existing scan output still reports pre-existing development fallbacks such as
  `dev-secret` and unrelated route/input-validation patterns outside this
  branch scope; no new secrets, private keys, API keys, or hardcoded production
  URLs were introduced.

## Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/ | grep -v 'Guard\|Auth'
rg 'JSON\.parse|eval\(' backend/src/
rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/ | grep -v 'Pipe\|Dto\|Validation'
git status --ignored --short
```
