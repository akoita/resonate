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

## Shows Supporter Badges And Roles - 2026-06-01

### Scope Reviewed

Changed files:

- `backend/src/events/event_types.ts`
- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- `backend/src/modules/community/community.service.ts`
- `backend/src/modules/community/community_eligibility.service.ts`
- `backend/src/modules/community/community_rooms.service.ts`
- `web/src/components/community/PublicCommunityProfile.tsx`
- `web/src/lib/api.ts`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Confirmed campaign support now derives private supporter badges and roles
  server-side from persisted `ShowPledge` rows; clients cannot self-assert
  badges or roles.
- Public profile reads expose campaign support cards from trusted confirmed or
  released pledge records only when the profile is public and
  `showCampaignSupport` is enabled; private badge rows are not used as public
  display source data.
- The public campaign-support payload includes campaign identity and coarse
  city/country only. Pledge amounts, wallet addresses, transaction hashes,
  receipts, and private support history remain excluded.
- New `community.badge_granted` and `community.role_granted` analytics payloads
  are compact and covered by analytics bridge redaction tests.
- Existing scan hits for hardcoded secret strings, raw SQL, and JSON parsing
  are pre-existing configuration/test or parameterized-query paths outside this
  slice. No changed diff adds secrets, raw SQL, unsafe parsing, XSS sinks, or
  cookie handling.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw' backend/src/
rg -n 'JSON\.parse|eval\(' backend/src/
rg -n 'dangerouslySetInnerHTML|innerHTML' web/src/
rg -n 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/
rg -n 'document\.cookie|setCookie|httpOnly.*false' web/src/
rg -n '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/community backend/src/modules/analytics backend/src/events | grep -v 'Guard\|Auth'
rg -n '@Body\(\)|@Query\(\)|@Param\(' backend/src/modules/community backend/src/modules/analytics | grep -v 'Pipe\|Dto\|Validation'
git diff -- backend/src web/src | rg -n 'secret|password|api_key|private_key|\$queryRaw|\$executeRaw|JSON\.parse|eval\(|dangerouslySetInnerHTML|innerHTML|document\.cookie|NEXT_PUBLIC_.*(SECRET|KEY|PASSWORD)'
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

## Artist Community Rooms - 2026-05-31

### Scope Reviewed

Changed backend surfaces:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260531143000_artist_community_rooms/migration.sql`
- `backend/src/modules/community/community.controller.ts`
- `backend/src/modules/community/community.module.ts`
- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/modules/community/community_eligibility.service.ts`
- `backend/src/tests/community*.ts`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Room mutation, membership, messaging, reporting, deletion, and moderation
  endpoints require JWT auth.
- Public artist-room listing is intentionally unauthenticated, but message
  reads require active membership or artist/operator authority.
- Holder-room joins delegate to `CommunityEligibilityService`, keeping private
  ownership and wallet proof details out of the room API.
- Announcement and moderation actions are restricted to the artist owner or
  operator/admin paths.
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

## Artist Community UI, Analytics, And Maintainer Checklist - 2026-05-31

### Scope Reviewed

Changed surfaces:

- `backend/src/modules/community/community.controller.ts`
- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/modules/analytics/analytics.controller.ts`
- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- `backend/src/events/event_types.ts`
- `web/src/components/community/ArtistCommunityTab.tsx`
- `web/src/app/artist/[id]/page.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/productAnalytics.ts`
- `docs/engineering/change_impact_checklist.md`
- `AGENTS.md`
- `.agents/workflows/finish-issue.md`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- The new authenticated artist-room read is JWT-gated and only adds
  membership/eligibility context for the current user.
- Holder-room denial analytics uses compact reason codes/copy and does not emit
  wallet holdings, ownership proofs, or private eligibility details.
- Community message analytics excludes message bodies and report free text.
- The artist Community tab uses React-rendered text only; no direct HTML
  injection APIs, cookie handling, or new public environment variables were
  introduced.
- The maintainer checklist is documentation-only and reinforces existing secret,
  config, analytics, privacy, moderation, lifecycle, and validation controls.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key' backend/src/modules/community backend/src/modules/analytics backend/src/events/event_types.ts web/src/components/community web/src/lib/api.ts web/src/lib/productAnalytics.ts docs/engineering AGENTS.md .agents/workflows/finish-issue.md --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|\$executeRaw|JSON\.parse|eval\(' backend/src/modules/community backend/src/modules/analytics web/src/components/community web/src/lib/api.ts web/src/lib/productAnalytics.ts
rg -n 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/components/community web/src/app/artist web/src/lib/api.ts web/src/lib/productAnalytics.ts
rg -n '@Controller|@Get|@Post|@Put|@Delete|@Patch|@Body\(\)|@Query\(\)|@Param\(' backend/src/modules/community backend/src/modules/analytics/analytics.controller.ts
```

## Shows Campaign Visual Uploads - 2026-05-31

### Scope Reviewed

Changed files:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260531152000_show_campaign_visuals/migration.sql`
- `backend/src/modules/shows/shows.controller.ts`
- `backend/src/modules/shows/shows.service.ts`
- `backend/src/modules/analytics/analytics.controller.ts`
- `backend/src/modules/analytics/analytics_event.ts`
- `backend/src/tests/shows.service.integration.spec.ts`
- `web/src/components/shows/*`
- `web/src/components/home/FeaturedCampaignHero.tsx`
- `web/src/app/shows/[campaignId]/page.tsx`
- `web/src/app/page.tsx`
- `web/src/lib/shows.ts`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Campaign visual uploads are restricted to authenticated artist, admin, and
  operator roles and reuse the existing campaign mutation ownership checks.
- Accepted upload MIME types are limited to JPEG, PNG, and WebP, with a
  configurable size cap via `SHOWS_VISUAL_MAX_BYTES`.
- Public visual reads stream from the configured storage provider and do not
  expose private storage paths in analytics payloads.
- `shows.campaign_visuals_updated` records changed slots only; raw image bytes,
  storage URIs, and public URLs stay out of analytics and warehouse facts.
- No raw SQL, hardcoded secrets, unsafe deserialization, direct HTML injection,
  cookie handling, or public secret environment variables were introduced.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key|BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY' backend/src/modules/shows backend/src/modules/analytics web/src/components/shows web/src/components/home web/src/app/shows web/src/lib/shows.ts web/src/app/page.tsx --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|JSON\.parse|eval\(' backend/src/modules/shows/shows.controller.ts backend/src/modules/shows/shows.service.ts backend/src/modules/analytics/analytics.controller.ts backend/src/modules/analytics/analytics_event.ts web/src/components/shows/CampaignDraftForm.tsx web/src/components/shows/CampaignHero.tsx web/src/components/shows/CampaignCard.tsx web/src/components/home/FeaturedCampaignHero.tsx 'web/src/app/shows/[campaignId]/page.tsx' web/src/lib/shows.ts web/src/app/page.tsx
rg -n 'dangerouslySetInnerHTML|innerHTML|document\.cookie|setCookie|httpOnly.*false|eval\(' web/src/components/shows web/src/components/home web/src/app/shows web/src/lib/shows.ts web/src/app/page.tsx
rg -n 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*PASSWORD|NEXT_PUBLIC_.*PRIVATE|NEXT_PUBLIC_.*TOKEN' web/src/components/shows web/src/components/home web/src/app/shows web/src/lib/shows.ts web/src/app/page.tsx
```

## Shows Campaign Visual Sets - 2026-06-01

### Scope Reviewed

Changed files:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260601003000_show_campaign_visual_sets/migration.sql`
- `backend/src/modules/shows/shows.controller.ts`
- `backend/src/modules/shows/shows.service.ts`
- `backend/src/tests/shows.service.integration.spec.ts`
- `web/src/app/page.tsx`
- `web/src/app/shows/[campaignId]/page.tsx`
- `web/src/components/shows/CampaignCard.tsx`
- `web/src/components/shows/CampaignDraftForm.tsx`
- `web/src/components/shows/CampaignHero.tsx`
- `web/src/lib/shows.ts`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Multi-file gallery upload remains restricted to authenticated artist, admin,
  and operator roles and still reuses campaign mutation ownership checks.
- Gallery visual reads are public campaign presentation assets, but storage
  URIs remain private and are not returned to clients or analytics payloads.
- Accepted MIME types remain JPEG, PNG, and WebP with the existing
  `SHOWS_VISUAL_MAX_BYTES` cap applied per uploaded file.
- The new visual-set analytics payload records slot/category and gallery count
  only; raw image bytes, storage URIs, captions, credits, and public URLs remain
  excluded from analytics and warehouse facts.
- No raw SQL, hardcoded secrets, unsafe deserialization, direct HTML injection,
  cookie handling, or public secret environment variables were introduced.

### Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/modules/shows backend/src/tests/shows.service.integration.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/shows backend/src/tests/shows.service.integration.spec.ts
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch|@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/shows/shows.controller.ts
rg 'JSON\.parse|eval\(' backend/src/modules/shows backend/src/tests/shows.service.integration.spec.ts
rg 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/app/page.tsx 'web/src/app/shows/[campaignId]/page.tsx' web/src/components/shows web/src/lib/shows.ts
```

## Shows Campaign Supporter Rooms - 2026-06-01

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/modules/shows/shows.controller.ts`
- `backend/src/modules/shows/shows.module.ts`
- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- `backend/src/events/event_types.ts`
- `web/src/components/shows/CampaignCommunityPanel.tsx`
- `web/src/app/shows/[campaignId]/page.tsx`
- `web/src/lib/shows.ts`
- `web/src/lib/api.ts`
- `web/src/styles/shows.css`
- related tests and feature/architecture docs

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Campaign supporter rooms are JWT-gated and use server-side
  `campaign_support` eligibility against confirmed `ShowPledge` state.
- The UI exposes safe locked copy and does not expose wallet holdings, private
  pledge details, transaction metadata, or support history.
- Campaign update analytics include compact campaign, room, and message
  references only; message bodies remain excluded from analytics payloads.
- No raw SQL, hardcoded secrets, unsafe deserialization, direct HTML injection,
  cookie handling, or new environment variables were introduced.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key|BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY' backend/src/modules/community backend/src/modules/shows backend/src/modules/analytics backend/src/events/event_types.ts web/src/components/shows web/src/app/shows web/src/lib/shows.ts web/src/lib/api.ts docs/features docs/architecture --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|\$executeRaw|JSON\.parse|eval\(' backend/src/modules/community backend/src/modules/shows backend/src/modules/analytics web/src/components/shows web/src/app/shows web/src/lib/shows.ts web/src/lib/api.ts
rg -n 'dangerouslySetInnerHTML|innerHTML|document\.cookie|setCookie|httpOnly.*false|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|NEXT_PUBLIC_.*PRIVATE|NEXT_PUBLIC_.*TOKEN' web/src/components/shows web/src/app/shows web/src/lib/shows.ts web/src/lib/api.ts
```

## Shows Campaign Visual Editor Management - 2026-06-01

### Scope Reviewed

Changed files:

- `backend/src/modules/shows/shows.controller.ts`
- `backend/src/modules/shows/shows.service.ts`
- `backend/src/modules/analytics/analytics_event.ts`
- `backend/src/tests/shows.service.integration.spec.ts`
- `web/src/components/shows/CampaignDraftForm.tsx`
- `web/src/lib/shows.ts`
- `web/src/styles/shows.css`
- `docs/features/README.md`
- `docs/features/resonate_shows.md`
- `docs/architecture/event_taxonomy_domain_model.md`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Gallery add, replace, delete, and reorder mutations remain restricted to
  authenticated artist, admin, and operator roles and reuse draft campaign
  mutation ownership checks.
- Gallery count is capped server-side across existing and newly uploaded files,
  not only per request.
- Public campaign visual reads still stream presentation assets without exposing
  storage URIs.
- `shows.campaign_visuals_updated` now includes compact `visualAction`,
  `visualSlots`, and gallery count fields only; raw bytes, storage URIs,
  captions, credits, and public image URLs remain excluded from analytics and
  warehouse facts.
- Stored object deletion failures after DB replacement/deletion are swallowed so
  a successfully persisted campaign edit is not rolled back by storage cleanup
  best-effort failure.
- No raw SQL, hardcoded secrets, unsafe deserialization, direct HTML injection,
  cookie handling, or new environment variables were introduced.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key|BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY' backend/src/modules/shows backend/src/modules/analytics/analytics_event.ts web/src/components/shows web/src/lib/shows.ts --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|\$executeRaw|JSON\.parse|eval\(' backend/src/modules/shows backend/src/modules/analytics/analytics_event.ts web/src/components/shows web/src/lib/shows.ts
rg -n 'dangerouslySetInnerHTML|innerHTML|document\.cookie|setCookie|httpOnly.*false|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|NEXT_PUBLIC_.*PRIVATE|NEXT_PUBLIC_.*TOKEN' web/src/components/shows web/src/lib/shows.ts
```
