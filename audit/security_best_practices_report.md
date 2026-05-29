# Security Best Practices Report

## Executive Summary

The #1005 player action layer changes were reviewed for public data exposure,
backend authorization boundaries, raw SQL usage, hardcoded secrets, client
secret exposure, XSS vectors, unsafe parsing, and token/cookie handling. No
Critical or High findings were identified for this branch.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

### SBPR-001: Public Player Actions Must Stay Redacted

**File:** `backend/src/modules/catalog/catalog.service.ts`

**Status:** Reviewed in this branch.

**Impact:** `GET /catalog/tracks/:trackId/actions` is a public endpoint used by
the player. If future changes include seller addresses, owner-only listing
lifecycle rows, wallet ownership, raw taste history, or private community
eligibility, the endpoint could expose information that belongs only in
authenticated owner or consented listener surfaces.

**Resolution:** The first implementation only returns compact public action
state. Marketplace/license availability is derived from active, unexpired,
positive-amount public listings and returns listing count, license tiers, first
listing ID, and chain ID only. Integration tests assert expired listing rows,
seller addresses, and unsanitized recommendation text are absent from the
response.

## Informational Findings

### SBPR-002: Existing Dev JWT Secret Fallbacks Are Local-Only

**File:** `backend/src/modules/auth/auth.module.ts`,
`backend/src/modules/auth/jwt.strategy.ts`

**Impact:** `dev-secret` fallback values exist for local development. These
were pre-existing and not touched by #1005.

**Assessment:** Acceptable only for local development. Shared environments must
provide `JWT_SECRET` through managed environment configuration or secret
management.

### SBPR-003: Public Client API-Key Environment Variables Are Present

**File:** `web/src/lib/bundlerConfig.ts`

**Impact:** `NEXT_PUBLIC_PIMLICO_API_KEY` is intentionally browser-exposed by
name. This was pre-existing and not touched by #1005.

**Assessment:** Treat it as a publishable client identifier, not a secret. Use
server-side proxying for any credential that must remain confidential.

### SBPR-004: Existing Artist Profile Placeholder Address Is Non-Secret

**File:** `web/src/lib/api.ts`

**Impact:** A fallback artist profile contains a placeholder payout address for
local/mock behavior. This was pre-existing and not introduced by #1005.

**Assessment:** This is not a private key or credential. Avoid using placeholder
addresses as production defaults for settlement behavior.

## Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\\$queryRaw' backend/src/`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/`
- `rg 'JSON\\.parse|eval\\(' backend/src/modules/catalog/catalog.controller.ts backend/src/modules/catalog/catalog.service.ts web/src/app/player/page.tsx web/src/lib/api.ts web/src/lib/productAnalytics.ts`
- `rg 'document\\.cookie|setCookie|httpOnly.*false' web/src/`
- `rg '@Controller|@Get|@Post|@Put|@Delete|@Patch|@Body\\(\\)|@Query\\(\\)|@Param\\(' backend/src/modules/catalog/catalog.controller.ts`
- `rg 'sellerAddress|ownerAddress|payoutAddress|paymentToken|private|secret|token' backend/src/modules/catalog/catalog.service.ts web/src/app/player/page.tsx web/src/lib/api.ts`
- Targeted review of #1005 backend action shaping, frontend player action
  handling, analytics payloads, and docs.
