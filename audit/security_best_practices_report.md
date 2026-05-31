# Security Best Practices Report

## Executive Summary

The #1007 agent-mediated playback intent slice was reviewed for authorization,
privacy redaction, command-confirmation safety, payment/licensing separation,
hardcoded secrets, raw SQL, unsafe parsing, and frontend exposure risks. No
Critical or High findings were identified for this branch.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

None.

## Low Findings

### SBPR-001: Playback Intent Endpoints Must Stay Owner-Scoped

**File:** `backend/src/modules/sessions/sessions.controller.ts`

**Status:** Reviewed in this branch.

**Impact:** Agent playback commands are sensitive because they can affect an
active listener device, analytics, taste memory, and artist demand signals. If
future endpoints accept a request-body `userId`, one authenticated user or
agent could target another owner's playback state.

**Resolution:** The new `/sessions/playback/*` endpoints use the existing JWT
guard and derive the owner from the authenticated request. Controller tests
cover that queue/resolve/confirm calls are scoped through the authenticated
owner boundary.

### SBPR-002: Do Not Claim Playback Started Before Client Confirmation

**File:** `backend/src/modules/sessions/playback_intents.service.ts`

**Status:** Reviewed in this branch.

**Impact:** Reporting `playing` from the backend before a browser/device
confirms audio execution would create misleading analytics, possible payout
distortion, and poor listener UX.

**Resolution:** Sound-starting play requests default to
`confirmation_required`, and `playing` is only produced by the explicit command
confirmation path. Tests cover confirmation-required and client-confirmed
playing outcomes.

### SBPR-003: Keep Playback Separate From Payment And Licensing

**File:** `backend/src/modules/sessions/playback_intents.service.ts`

**Status:** Reviewed in this branch.

**Impact:** Agent playback authority must not silently grant spend, license,
x402 download, marketplace buy, or stem decrypt authority.

**Resolution:** Playback capabilities are modeled separately from payment and
licensing scopes. Resolve returns sanitized catalog candidates and command
policy, while queue/play/control command paths do not call purchase, license,
download, or decrypt services.

## Informational Findings

### SBPR-004: Existing Secret/Key References Are Configuration Reads

**Files:** `backend/src/modules/agents/agent_observability.service.ts`,
`web/src/lib/bundlerConfig.ts`, `web/src/lib/passkeyConfig.ts`

**Impact:** Scans found existing references to environment-backed Langfuse,
Pimlico, and passkey configuration.

**Assessment:** These are pre-existing configuration reads, not new hardcoded
secrets. This branch does not add secrets or new environment variables.

### SBPR-005: Existing JSON Parsing Remains Outside The Changed Slice

**Files:** `backend/src/modules/analytics/analytics_warehouse_loader.ts`,
`backend/src/modules/analytics/analytics_bigquery_report.ts`,
`backend/src/modules/agents/model_assisted_recommendation.adapter.ts`

**Impact:** Existing JSON parsing paths were detected outside the playback
intent changes.

**Assessment:** No new backend `JSON.parse`, `eval`, raw SQL, or query-string
construction was introduced in the changed implementation.

## Scans Run

- `rg -n 'password|secret|api_key|private_key' backend/src/modules/sessions backend/src/modules/analytics backend/src/modules/agents --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg -n 'rawQuery|executeRaw|\\$queryRaw|\\$executeRaw' backend/src/modules/sessions backend/src/modules/analytics backend/src/modules/agents`
- `rg -n 'JSON\\.parse|eval\\(' backend/src/modules/sessions backend/src/modules/analytics backend/src/modules/agents`
- `rg -n 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\\.cookie|httpOnly.*false' web/src/lib`
- `rg -n '@(Get|Post|Put|Delete|Patch)\\(' backend/src/modules/sessions/sessions.controller.ts -C 2`
- `git diff -- backend/src/modules/sessions backend/src/modules/analytics backend/src/modules/agents web/src/lib | rg -n 'secret|password|api_key|private_key|\\$queryRaw|\\$executeRaw|JSON\\.parse|eval\\(|dangerouslySetInnerHTML|innerHTML|document\\.cookie|NEXT_PUBLIC_.*(SECRET|KEY|PASSWORD)'`
- Targeted review of #1007 playback-intent service, authenticated controller
  routes, analytics marker propagation, frontend API helpers, tests, and docs.

## Shows Campaign Identity And Catalog Subject Gate - 2026-05-31

### Scope Reviewed

Changed files:

- `backend/src/modules/shows/shows.service.ts`
- `backend/src/tests/shows.service.integration.spec.ts`
- `web/src/components/shows/*`
- `web/src/app/shows/*`
- `web/src/components/home/FeaturedCampaignHero.tsx`
- `web/src/lib/shows.ts`
- `docs/features/README.md`
- `docs/features/resonate_shows.md`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Active escrow campaign drafts now require a selected platform artist with at
  least one ready or published release, reducing impersonation and same-name
  ambiguity before pledge collection.
- Public campaign display title is now separated from the platform artist
  profile used for authority and payout safety.
- Shows mutation endpoints remain behind existing JWT and role guards; the new
  catalog-content gate runs server-side before draft creation or update.
- The changed frontend surfaces render campaign and artist data through React
  nodes and CSS background images; no direct HTML injection, client secrets, or
  cookie handling were introduced.

### Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/modules/shows backend/src/tests/shows.service.integration.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/shows backend/src/tests/shows.service.integration.spec.ts
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch|@Body\(\)|@Query\(\)|@Param\(' backend/src/modules/shows backend/src/modules/artist backend/src/modules/catalog
rg 'JSON\.parse|eval\(' backend/src/modules/shows backend/src/tests/shows.service.integration.spec.ts
rg 'dangerouslySetInnerHTML|innerHTML' web/src/components/shows web/src/app/shows web/src/components/home/FeaturedCampaignHero.tsx web/src/lib/shows.ts
rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/components/shows web/src/app/shows web/src/components/home/FeaturedCampaignHero.tsx web/src/lib/shows.ts
rg 'document\.cookie|setCookie|httpOnly.*false' web/src/components/shows web/src/app/shows web/src/components/home/FeaturedCampaignHero.tsx web/src/lib/shows.ts
```
