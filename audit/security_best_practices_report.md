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

## Community Profile Visibility Controls - 2026-05-31

### Scope Reviewed

Changed files:

- `backend/src/modules/community/*`
- `backend/src/events/event_types.ts`
- `backend/src/modules/analytics/analytics.controller.ts`
- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- `backend/src/modules/app.module.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260531012000_community_profile_visibility/migration.sql`
- `web/src/components/settings/CommunityProfileSettingsPanel.tsx`
- `web/src/app/settings/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/productAnalytics.ts`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- The public `GET /community/profile/:userId` route is intentional for public
  profile showcase reads.
- Public profile reads return only profiles whose visibility is `public`.
- Wallet, ownership, taste, playlist, campaign, and show-attendance sections
  are redacted unless each section is explicitly enabled by the listener.
- Self-profile read and update routes remain protected by JWT auth.

### Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/modules/community backend/src/events/event_types.ts backend/src/modules/analytics/analytics.controller.ts backend/src/modules/analytics/analytics_domain_event_bridge.service.ts backend/src/modules/app.module.ts --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/community backend/src/events/event_types.ts backend/src/modules/analytics/analytics.controller.ts backend/src/modules/analytics/analytics_domain_event_bridge.service.ts backend/src/modules/app.module.ts
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch|@Body\(\)|@Query\(\)|@Param\(' backend/src/modules/community backend/src/modules/analytics/analytics.controller.ts
rg 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/components/settings/CommunityProfileSettingsPanel.tsx web/src/app/settings/page.tsx web/src/lib/api.ts web/src/lib/productAnalytics.ts
```

## Shows Declared Catalog Artist Selector - 2026-05-31

### Scope Reviewed

Changed files:

- `backend/src/modules/shows/shows.service.ts`
- `backend/src/tests/shows.service.integration.spec.ts`
- `web/src/components/shows/CampaignDraftForm.tsx`
- `web/src/lib/shows.ts`
- `web/src/lib/shows.test.ts`
- `docs/features/README.md`
- `docs/features/resonate_shows.md`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Campaign artist selection now uses declared catalog artist credits instead
  of uploader profiles, reducing identity confusion when one platform profile
  uploads releases for multiple credited artists.
- Server-side validation still rejects free-text/off-catalog artist subjects,
  requires ready or published catalog content, and keeps artist-owned payout
  safety tied to the authenticated artist profile.
- No raw SQL, hardcoded secrets, direct HTML injection, cookie handling, or new
  environment variables were introduced.

### Commands Run

```bash
rg -n "password|secret|api_key|private_key" backend/src/modules/shows backend/src/tests/shows.service.integration.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n "rawQuery|executeRaw|\$queryRaw|dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false" backend/src/modules/shows web/src/components/shows web/src/lib/shows.ts
```

## Release Artist Identity Refactor - 2026-05-31

### Scope Reviewed

Changed backend/frontend surfaces:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260531043000_release_artist_credits/migration.sql`
- `backend/src/modules/catalog/*`
- `backend/src/modules/analytics/*`
- `backend/src/modules/contracts/*`
- `backend/src/modules/generation/generation.service.ts`
- `backend/src/modules/rights/*`
- `web/src/app/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/shows.ts`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Public artist profiles can now be unclaimed and therefore have nullable
  `userId` and `payoutAddress`. Authorization-sensitive paths that still rely
  on uploader/manager ownership were reviewed and updated to fail closed when
  the manager user id is absent.
- Release artist credits are display/discovery metadata. The implementation
  keeps `Release.artistId` as the manager/uploader ownership key for rights,
  payout-adjacent workflows, and current authenticated artist analytics.
- The migration uses deterministic SQL backfill and Prisma parameterized raw
  queries already present in the catalog/contract paths; no string-concatenated
  SQL was introduced.
- Analytics payloads keep compatibility `artistId` while adding explicit
  manager and credited-artist dimensions, reducing downstream ambiguity without
  changing current dashboard authorization.
- No new hardcoded secrets, client-exposed secret variables, direct HTML
  injection, cookie handling, or new environment variables were introduced.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg -n '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/ | grep -v 'Guard\|Auth'
rg -n 'JSON\.parse|eval\(' backend/src/
rg -n '@Body\(\)|@Query\(\)|@Param\(' backend/src/modules/catalog backend/src/modules/analytics backend/src/modules/contracts backend/src/modules/generation backend/src/modules/rights | grep -v 'Pipe\|Dto\|Validation'
rg -n 'dangerouslySetInnerHTML|innerHTML' web/src/
rg -n 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/
rg -n 'document\.cookie|setCookie|httpOnly.*false' web/src/
```

## Community Holder Benefits - 2026-05-31

### Scope Reviewed

Changed backend surfaces:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260531045500_community_holder_benefits/migration.sql`
- `backend/src/modules/community/community.controller.ts`
- `backend/src/modules/community/community.module.ts`
- `backend/src/modules/community/community_eligibility.service.ts`
- `backend/src/tests/community*.ts`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Badge, role, benefit, and redemption reads are authenticated user-scoped
  endpoints.
- Public profile display remains separate from benefit eligibility; the
  eligibility response exposes private proof summaries, not wallet addresses or
  raw ownership details.
- Ownership eligibility is derived from indexed backend `StemPurchase` and
  wallet state rather than client-submitted ownership claims.
- No raw SQL, hardcoded secrets, unsafe deserialization, direct HTML injection,
  cookie handling, or new environment variables were introduced.

### Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/modules/community backend/src/tests/community* --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/community backend/src/tests/community*
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch|@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/community
rg 'JSON\.parse|eval\(' backend/src/modules/community backend/src/tests/community*
```

## Shows Managed Catalog Artist Selection Fix - 2026-05-31

### Scope Reviewed

Changed files:

- `backend/src/modules/shows/shows.service.ts`
- `backend/src/tests/shows.service.integration.spec.ts`
- `web/src/components/shows/CampaignDraftForm.tsx`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Regular artist-manager users can now select campaign subjects from credited
  artists in their managed catalog. The backend still rejects unrelated artist
  identities and keeps the beneficiary wallet tied to the authenticated manager
  payout profile.
- Operators keep the global catalog selection path.
- The fix does not introduce raw SQL, hardcoded secrets, unsafe parsing, direct
  HTML injection, cookie handling, or new environment variables.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key' backend/src/modules/shows web/src/components/shows/CampaignDraftForm.tsx --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|JSON\.parse|eval\(' backend/src/modules/shows web/src/components/shows/CampaignDraftForm.tsx
rg -n 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/components/shows/CampaignDraftForm.tsx
```
