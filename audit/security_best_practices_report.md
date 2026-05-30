# Security Best Practices Report

## Executive Summary

The #1009 listener taste memory controls were reviewed for backend
authorization, user-data exposure, raw SQL, hardcoded secrets, unsafe parsing,
client XSS vectors, public client secrets, and analytics payload boundaries. No
Critical or High findings were identified for this branch.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

### SBPR-001: Keep Taste Memory Bound To The Authenticated User

**File:** `backend/src/modules/recommendations/recommendations.controller.ts`

**Status:** Reviewed in this branch.

**Impact:** Taste memory settings and hidden/downranked signals are private
listener controls. If future endpoints accepted arbitrary `userId` values for
these controls, one authenticated user could inspect or mutate another user's
taste governance state.

**Resolution:** The new taste memory endpoints derive the user from
`req.user.userId` and do not accept a user identifier in the request body or
path. Controller tests assert the service receives only the authenticated
listener ID.

### SBPR-002: Sanitized Taste Summaries Must Stay Coarse

**File:** `backend/src/modules/recommendations/taste_memory.service.ts`

**Status:** Reviewed in this branch.

**Impact:** Taste memory is derived from `AgentSignal` rows and can become
sensitive if raw listening history, exact counts, wallet/ownership state,
URLs, emails, or model traces are exposed.

**Resolution:** The response returns ranked labels and coarse patterns only.
Signal values pass through bounded string sanitization, and the UI/API expose
privacy notes instead of raw events. Reset is a timestamp marker, preserving
auditability while excluding old signals from serving inputs.

### SBPR-003: Governed Analytics Payloads Should Stay Minimal

**File:** `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`

**Status:** Reviewed in this branch.

**Impact:** Taste memory settings changes and signal controls are user
governance events. Overly detailed analytics payloads could recreate private
taste history or leak sensitive labels.

**Resolution:** Domain bridge events use `taste_memory_controls:v1` consent
basis and carry only setting summaries or safe signal type/value/action
metadata. No raw listening history, wallet data, ownership data, or model
internals are added.

## Informational Findings

### SBPR-004: Existing Dev JWT Secret Fallbacks Are Local-Only

**File:** `backend/src/modules/auth/auth.module.ts`,
`backend/src/modules/auth/jwt.strategy.ts`

**Impact:** `dev-secret` fallback values exist for local development. These
were pre-existing and not touched by #1009.

**Assessment:** Acceptable only for local development. Shared environments must
provide `JWT_SECRET` through managed environment configuration or secret
management.

### SBPR-005: Existing Parameterized Raw SQL Remains Outside This Slice

**File:** `backend/src/main.ts`,
`backend/src/modules/catalog/catalog.service.ts`,
`backend/src/modules/contracts/contracts.service.ts`,
`backend/src/modules/embeddings/embedding.store.ts`

**Impact:** Existing raw SQL usages were detected outside the changed taste
memory code. They appear to use Prisma tagged-template parameterization or
static statements and were not modified by #1009.

**Assessment:** No new raw SQL was introduced in the changed backend files.

## Scans Run

- `rg -n 'password|secret|api_key|private_key' backend/src backend/prisma --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg -n 'rawQuery|executeRaw|\\$queryRaw' backend/src backend/prisma`
- `rg -n 'JSON\\.parse|eval\\(' backend/src/modules/recommendations backend/src/modules/agents backend/src/modules/analytics backend/src/events`
- `rg -n 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\\.cookie|setCookie|httpOnly.*false' web/src/components/settings web/src/app/settings web/src/lib/api.ts web/src/lib/productAnalytics.ts`
- `rg -n '@Controller|@Get|@Post|@Put|@Delete|@Patch|@Body\\(\\)|@Query\\(\\)|@Param\\(' backend/src/modules/recommendations/recommendations.controller.ts backend/src/modules/recommendations/taste_memory.service.ts`
- `git diff -- backend/src/modules/recommendations/recommendations.controller.ts backend/src/modules/recommendations/taste_memory.service.ts backend/src/modules/recommendations/recommendations.service.ts backend/src/modules/agents/agent_learning.service.ts backend/src/modules/agents/agent_selector.service.ts | rg -n 'secret|password|api_key|private_key|\\$queryRaw|\\$executeRaw|JSON\\.parse|eval\\(|dangerouslySetInnerHTML|innerHTML|document\\.cookie'`
- Targeted review of #1009 backend taste memory service, authenticated
  controller routes, recommendation/agent policy wiring, Settings UI, API
  helpers, analytics domain bridge events, Prisma migration, tests, and docs.
