# Security Best Practices Report

## Executive Summary

Reviewed the backend CORS allowlist change for frontend-origin recovery after
the staging redeploy. No Critical or High findings were identified in the
changed code.

## Scope

- `backend/src/config/cors.ts`
- `backend/src/main.ts`
- `backend/src/tests/cors.spec.ts`
- `backend/.env.example`
- `docs/deployment/environment.md`

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None in the changed code.

## Low Findings

None in the changed code.

## Informational Notes

- Backend CORS origins now come from a centralized helper instead of inline
  parsing in `main.ts`.
- The helper keeps the existing localhost defaults and derives deployed browser
  origins from `CORS_ORIGIN`, `CORS_ORIGINS`, `FRONTEND_URL`, and
  `WEBAUTHN_ORIGIN`.
- Origin values are normalized to URL origins where possible, so accidental
  paths or trailing slashes in environment variables do not break browser
  preflight checks.
- No wildcard origin was introduced. `*` is preserved only if explicitly set in
  an environment variable.
- Broad scans surfaced pre-existing backend secret references, raw SQL, JSON
  parsing, and controller body typing in unrelated modules. They were reviewed
  as out of scope for this branch and are not introduced by these changes.

## Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg 'JSON\.parse|eval\(' backend/src/
rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules --glob '!*.spec.ts'
cd backend && npm run lint
cd backend && npx jest --runInBand --config jest.config.js --testPathPattern='cors.spec'
git diff --check
```
