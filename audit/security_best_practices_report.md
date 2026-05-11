# Security Best Practices Report

## Executive Summary

Reviewed the trusted-source linking implementation for #495. No Critical or
High findings were identified in the changed code.

## Scope

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260511010000_trusted_source_linking/migration.sql`
- `backend/src/modules/contracts/metadata.controller.ts`
- `backend/src/modules/rights/rights-evidence.ts`
- `backend/src/modules/rights/rights.module.ts`
- `backend/src/modules/rights/trusted-source.service.ts`
- `backend/src/modules/rights/upload-rights-routing.service.ts`
- `backend/src/tests/trusted-source.service.integration.spec.ts`
- `backend/src/tests/upload-rights-routing.integration.spec.ts`
- `web/src/lib/api.ts`
- `web/src/lib/api.test.ts`
- Related architecture documentation updates

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None in the changed code.

## Low Findings

None in the changed code.

## Informational Notes

- New creator-facing trusted-source endpoints require JWT auth. New admin review
  and revocation endpoints require both JWT auth and the `admin` role guard.
- Source-link submission resolves the authenticated artist by wallet/user id and
  does not allow callers to choose an arbitrary artist id.
- Source-link approvals and revocations are centralized in
  `TrustedSourceService`; active links are checked by upload routing, and
  revoked/suspended links no longer produce trusted-source routing context.
- Prisma writes use structured client APIs. The changed code does not add raw
  SQL, dynamic code execution, browser HTML injection, cookie handling, or new
  public client secrets.
- The broad scans still report pre-existing items outside this change set, such
  as local-dev JWT fallbacks and existing raw SQL in unrelated modules. These
  are not introduced by #495.

## Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/rights backend/src/modules/contracts/metadata.controller.ts | grep -v 'Guard\|Auth' || true
rg 'JSON\.parse|eval\(' backend/src/modules/rights backend/src/modules/contracts/metadata.controller.ts
rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/rights backend/src/modules/contracts/metadata.controller.ts | grep -v 'Pipe\|Dto\|Validation' || true
rg 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/lib/api.ts web/src/lib/api.test.ts
npm run lint # backend
npx prisma validate # backend
npx jest --runInBand --config jest.integration.config.js --testPathPattern='trusted-source.service.integration|upload-rights-routing.integration' # backend
npx eslint src/lib/api.ts src/lib/api.test.ts # web
npx tsc --noEmit # web
npx vitest run src/lib/api.test.ts # web
git diff --check
```
