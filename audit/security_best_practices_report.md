# Security Best Practices Report

## Executive Summary

Reviewed the continuous rights route reassessment implementation for #496. No
Critical or High findings were identified in the changed code.

## Scope

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260511152000_rights_route_reassessment/migration.sql`
- `backend/src/modules/contracts/metadata.controller.ts`
- `backend/src/modules/rights/rights-route-reassessment.service.ts`
- `backend/src/modules/rights/rights.module.ts`
- `backend/src/tests/rights-route-reassessment.integration.spec.ts`
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

- New reassessment creation, sampling, pending-list, and review endpoints require
  JWT auth plus the `admin` role guard.
- Release reassessment history is JWT-protected and limited to the release owner
  or admins.
- Evidence submission can create pending reassessment records, but it does not
  apply route changes automatically.
- Trusted-source revocation downgrades only matching `TRUSTED_FAST_PATH`
  releases for the revoked source type and records applied reassessment history.
- Prisma writes use structured client APIs. The changed code does not add raw
  SQL, dynamic code execution, browser HTML injection, cookie handling, or new
  public client secrets.
- The broad scans may still report pre-existing items outside this change set,
  such as local-dev secret fallbacks and existing raw SQL in unrelated modules.
  These are not introduced by #496.

## Commands Run

```bash
npx prisma generate # backend
npx prisma validate # backend
npm run lint # backend
npm test # backend
npx jest --runInBand --config jest.integration.config.js --testPathPattern='rights-route-reassessment.integration|trusted-source.service.integration|upload-rights-routing.integration' # backend
npm run lint # web
npx tsc --noEmit # web
npx vitest run src/lib/api.test.ts # web
npx vitest run # web
git diff --check
rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/rights backend/src/modules/contracts/metadata.controller.ts
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/rights backend/src/modules/contracts/metadata.controller.ts | grep -v 'Guard\|Auth' || true
rg 'JSON\.parse|eval\(' backend/src/modules/rights backend/src/modules/contracts/metadata.controller.ts
rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/rights backend/src/modules/contracts/metadata.controller.ts | grep -v 'Pipe\|Dto\|Validation' || true
rg 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/lib/api.ts web/src/lib/api.test.ts
```
