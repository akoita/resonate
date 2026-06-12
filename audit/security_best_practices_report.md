# Security Best Practices Report

## Artist Remix Consent Control - 2026-06-11

### Scope Reviewed

Changed files (#1169):

- `backend/prisma/schema.prisma` and migration
  `20260611193000_artist_remix_consent`
- `backend/src/modules/artist/*` (owner-scoped settings API)
- `backend/src/modules/remix/remix-eligibility.policy.ts` and
  `remix-eligibility.service.ts` (server-side policy enforcement)
- `backend/src/events/event_types.ts` and
  `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- Backend policy, controller, integration, and analytics bridge tests
- `web/src/components/settings/ArtistRemixSettingsPanel.tsx`,
  `web/src/app/settings/page.tsx`, and `web/src/lib/api.ts`
- `docs/features/remix_studio.md`,
  `docs/features/remix_studio_backlog.md`, and `docs/features/README.md`

### Executive Summary

No Critical or High findings. The artist-level remix setting is enforced in
the backend eligibility policy, not merely hidden in the UI. The settings API
resolves the managed artist from the authenticated user and rejects route ids
that do not belong to that user; the client update body carries only
`remixConsent`. Existing artists keep default eligibility through the
`allowed` migration default, while `disabled` denies project creation and
generation with `artist_remix_disabled`.
## Remix Studio Queue-Backed Generation Jobs - 2026-06-12

### Scope Reviewed

Changed files (#1167):

- `backend/src/modules/remix/remix-project.service.ts`,
  `backend/src/modules/remix/remix-generation.processor.ts`,
  `backend/src/modules/remix/remix.controller.ts`,
  `backend/src/modules/remix/remix.module.ts`
- `backend/src/events/event_types.ts` and
  `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- `web/src/lib/api.ts` and
  `web/src/components/remix/RemixStudioEditor.tsx`
- Remix backend/web tests and feature documentation

### Executive Summary

No Critical or High findings. The generate endpoint remains JWT owner-scoped,
validates constraints/rate limits/eligibility before enqueue, and blocks
duplicate active work with a conditional database claim. The new worker calls
only the existing `RemixGenerationProvider` boundary, records terminal
completed/failed state, and emits compact lifecycle events that carry ids and
status only, not prompts or raw audio/storage content.
### Critical Findings

None.

### High Findings

None.

### Notes

- The new domain event bridge includes `artistId` in `payloadKeys`, avoiding
  silent attribution loss during compact payload construction.
- The frontend panel does not render user-supplied HTML, touch cookies, add
  browser secrets, or trust a client-submitted artist id for authorization.
- Secret/config scans hit pre-existing shared analytics/auth utilities
  (`analytics_identity.ts`, BigQuery endpoints) and the existing mock-auth
  `localStorage` check in `web/src/lib/api.ts`; none were introduced by this
  slice.
- Change impact checklist sections reviewed: API contract, privacy and
  permission boundaries, analytics/events, frontend copy/state, feature docs,
  Prisma migration, and validation scope.

### Scans Run

- `rg -i 'password|secret|api_key|private_key' backend/src/modules/artist backend/src/modules/remix backend/src/modules/analytics backend/src/events web/src/components/settings/ArtistRemixSettingsPanel.tsx web/src/app/settings/page.tsx web/src/lib/api.ts --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw|\$executeRaw' backend/src/modules/artist backend/src/modules/remix backend/src/modules/analytics backend/src/events`
- `rg 'dangerouslySetInnerHTML|innerHTML|document\.cookie|setCookie|localStorage|sessionStorage' web/src/components/settings/ArtistRemixSettingsPanel.tsx web/src/app/settings/page.tsx web/src/lib/api.ts`
- `rg 'https?://(?!localhost)' backend/src/modules/artist backend/src/modules/remix backend/src/modules/analytics backend/src/events web/src/components/settings/ArtistRemixSettingsPanel.tsx web/src/app/settings/page.tsx web/src/lib/api.ts -P`
- The new `prisma.$executeRaw` calls use Prisma tagged templates with bound
  `jobId`, `projectId`, and JSON metadata parameters; no string-concatenated
  SQL was introduced.
- BullMQ job data is built server-side after ownership, draft status, prompt,
  constraint, rate-limit, and remix eligibility checks. Client-supplied job ids
  are not accepted.
- `force=true` remains a compatibility alias, but new client behavior uses
  explicit `retry=true` and still refuses pending/processing duplicates.
- Studio polling uses the existing authenticated `getRemixProject` helper and
  does not expose raw storage URIs. Draft playback still goes through the
  owner-scoped `draft-audio` endpoint.
- No new environment variables, secrets, hardcoded production URLs, cookies, or
  `dangerouslySetInnerHTML` paths were added.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/`
- `rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/`
- `rg 'JSON\.parse|eval\(' backend/src/`
- `rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/`
- `rg 'document\.cookie|setCookie|httpOnly.*false' web/src/`- `git diff --check`

## Artist Action Cockpit P7 Tail Cards - 2026-06-11

### Scope Reviewed

Changed files (#1121):

- `backend/src/modules/analytics/analytics.service.ts`
  (`review_remix_supply_pricing`, `triage_fan_questions` derivation)
- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`,
  `backend/src/modules/analytics/analytics_warehouse.ts`,
  `backend/src/events/event_types.ts`, and
  `backend/src/modules/community/community_rooms.service.ts`
  (compact `artistId` and `messageType` attribution for community messages)
- `web/src/lib/api.ts` and
  `web/src/components/analytics/ArtistAnalyticsDashboard.test.tsx`
  (frontend card type mirror and real-shape fixtures)
- `docs/features/analytics_dashboard.md` and `docs/features/README.md`

### Executive Summary

No Critical or High findings. The new action cards are deterministic,
server-derived, and use only artist-attributed facts or artist-owned owner
inventory summaries. Listener-derived remix demand and community message counts
reuse the existing five-signal floor before surfacing counts. The bridge update
adds compact attribution metadata for `community.message_created`; it does not
include message bodies, author ids in dashboard DTOs, wallet addresses, room
membership, or per-listener drilldowns.

### Critical Findings

None.

### High Findings

None.

### Notes

- The remix supply-pricing card requires an actual
  `marketplace.owner_inventory_viewed` snapshot before treating active owner
  inventory as zero, so missing analytics is not interpreted as supply absence.
- The fan-triage card is suppressed by aggregate artist update signals
  (`announcement` or `campaign_update`) and never inspects message content.
- The frontend change only mirrors backend response types and renders existing
  card schema fields; no HTML injection, cookie handling, or secret-bearing
  client config paths were added.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/analytics backend/src/modules/community backend/src/events --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/analytics backend/src/modules/community backend/src/events`
- `rg 'JSON\.parse|eval\(' backend/src/modules/analytics backend/src/modules/community backend/src/events`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/components/analytics web/src/lib/api.ts`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/components/analytics web/src/lib/api.ts`
- `git diff --check`

## Stem Detail Page Redesign And Remix Access - 2026-06-10

### Scope Reviewed

Changed files (#1145):

- `web/src/app/stem/[tokenId]/page.tsx` (redesign) + 3 more files losing the
  undocumented `NEXT_PUBLIC_BACKEND_URL` (`ContentProtectionBadge`,
  `useSynthIdVerification`, `useLyriaRealtime`)
- `web/src/components/stem/StemDetailSections.tsx`,
  `web/src/lib/stemPageTheme.ts` (+ tests)
- `web/src/app/marketplace/page.tsx`, `web/src/app/release/[id]/page.tsx`
  (navigation links)
- `backend/src/modules/remix/remix-eligibility.policy.ts` + service
  (partial allowance v2), `web/src/components/remix/RemixCta.tsx`
  (licensed+remixable subset filter)

### Executive Summary

No Critical or High findings. The config fix removes an undocumented env
dependency that silently disabled the remix entry point on deployed
environments; all browser fetches now use the canonical `API_BASE`. The
redesigned page consumes only public endpoints (token metadata, public
listings, stem pricing, catalog preview) plus the authenticated eligibility
CTA; no new authority paths. The partial-allowance policy relaxes only
track-default CTA gating — explicit stem selections (project creation,
generation) still require every stem licensed and remixable, so no rights
expansion reaches project inputs; drafts are built from the licensed,
remixable subset on both client and server.

### Critical Findings

None.

### High Findings

None.

### Notes

- New external links (explorer, ipfs.io gateway) use
  `rel="noopener noreferrer"`; artwork renders via `img` from API-served
  URLs, no `dangerouslySetInnerHTML`.
- Copy-link writes the current URL to the clipboard; no user-generated
  content involved.
- The metadata-fallback banner reveals only that the catalog is unreachable.

### Scans Run

- `rg 'dangerouslySetInnerHTML|innerHTML|document\.cookie|setCookie' <changed frontend files>`
- `rg -i 'password|secret|api_key|private_key' <changed files>`
- Hardcoded non-localhost URL grep (explorer/ipfs allowlist)
- `git diff --check`

## Seller License-Tier Listings - 2026-06-10

### Scope Reviewed

Changed files (#1141, frontend-only):

- `web/src/lib/listingTiers.ts` (+ test)
- `web/src/components/marketplace/ListStemModal.tsx` (+ test)
- `web/src/components/marketplace/BatchMintListModal.tsx`
- `web/src/components/marketplace/MintStemButton.tsx`
- `web/src/hooks/useContracts.ts` (batch licenseType option)
- `web/src/app/stem/[tokenId]/page.tsx` (stemId prop)

### Executive Summary

No Critical or High findings. The slice threads a seller-chosen license tier
through the existing notify-listing/listing-intent path. The tier is
listing metadata, not a rights grant: buyer-side rights still derive from
indexed `StemPurchase.licenseType` server-side, the backend already
normalizes unknown tier values to `personal`
(`normalizeListingLicenseType`), and the notify-listing intent only stamps
listings whose on-chain transaction hash matches. Price prefill reads the
stem's public catalog pricing endpoint; no secrets, XSS vectors, cookie
handling, or hardcoded non-localhost URLs in the changed slice.

### Critical Findings

None.

### High Findings

None.

### Notes

- notify-listing remains best-effort after the on-chain transaction; on
  failure the listing indexes with the conservative `personal` default.
- The edition hint is fixed product copy; no user-generated content rendered.
- `licenseType` values are constrained by TS unions client-side and
  normalized server-side; clients cannot mint rights by sending arbitrary
  tier strings for transactions they did not submit (intent rows key on
  transactionHash + tokenId of the seller's own listing).

### Scans Run

- `rg 'dangerouslySetInnerHTML|innerHTML|document\.cookie|setCookie' <changed files>`
- `rg -i 'password|secret|api_key|private_key|https?://(?!localhost)' -P <changed files>`
- `git diff --check`

## Remix Generation Provider Boundary - 2026-06-10

### Scope Reviewed

Changed files (#896):

- `backend/src/modules/remix/remix-generation.provider.ts` (new boundary)
- `backend/src/modules/remix/remix-project.service.ts` (generateDraft)
- `backend/src/modules/remix/remix.controller.ts` (generate route + error map)
- `backend/src/modules/remix/remix.module.ts` (provider binding)
- `backend/src/events/event_types.ts` + analytics bridge (generation events)
- remix test files; `docs/deployment/environment.md`

### Executive Summary

No Critical or High findings. The generate endpoint is owner-gated and
re-runs the eligibility policy server-side before any provider call, so
creation-time rights state is never trusted for generation; the provider is
disabled by default (`REMIX_GENERATION_ENABLED` opt-in) and failures return a
fixed normalized error contract; voice/likeness is hard-disabled at the type
level (`voiceLikenessAllowed: false` literal) in the provider input; analytics
event payloads exclude prompt text; persisted generation metadata echoes only
ids, mode, constraints, cost, and policy version.

### Critical Findings

None.

### High Findings

None.

### Notes

- Provider errors map to fixed HTTP statuses (503/400/422) with no
  vendor-internal detail leakage; messages are product copy.
- The stub provider produces no audio and performs no external calls.
- Duplicate-job rejection prevents accidental provenance overwrite; `force`
  remains owner-scoped.

### Scans Run

- `rg -i 'password|secret|api_key|private_key' backend/src/modules/remix/`
- `rg 'rawQuery|executeRaw|\$queryRaw|eval\(' backend/src/modules/remix/`
- `git diff --check`

## Remix Studio Editor And Draft Reuse - 2026-06-10

### Scope Reviewed

Changed files (#895):

- `backend/src/modules/remix/remix-project.service.ts` (source summary in
  reads, validated mode updates)
- `backend/src/modules/remix/remix.controller.ts` (PATCH body type)
- `web/src/components/remix/RemixStudioEditor.tsx` (+ test)
- `web/src/components/remix/RemixCta.tsx` (draft reuse, aria-disabled)
- `web/src/app/remix/studio/[projectId]/page.tsx` (editor wiring)
- `web/src/lib/api.ts` (types + PATCH helper)

### Executive Summary

The studio editor slice adds no Critical or High findings. The enriched
project reads expose only public catalog fields (track/release titles, artist
credit, rights route, content status, stem type/title) on an owner-gated
endpoint; mode updates are validated against the fixed mode list server-side;
saves go through the existing owner-checked PATCH; draft reuse reads only the
caller's own project list; publish/export remain non-functional unavailable
states with honest copy and no hidden enablement path.

### Critical Findings

None.

### High Findings

None.

### Notes

- All user-visible denial/limitation copy is fixed product copy or backend
  policy strings — no user-generated content is rendered as HTML.
- The editor patches only changed fields (minimal PATCH payloads) and never
  sends identity claims; ownership stays server-enforced.
- No XSS/cookie patterns, secrets, raw SQL, or hardcoded non-localhost URLs
  in the changed slice (scan output below).

### Scans Run

- `rg 'dangerouslySetInnerHTML|innerHTML|document\.cookie|setCookie' web/src/components/remix/ web/src/app/remix/`
- `rg -i 'password|secret|api_key|private_key' backend/src/modules/remix/ web/src/components/remix/`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/remix/`
- `git diff --check`

## Remix CTAs And Studio Stub - 2026-06-10

### Scope Reviewed

Changed files (#894):

- `web/src/components/remix/RemixCta.tsx` (+ test)
- `web/src/app/remix/studio/[projectId]/page.tsx`
- `web/src/app/release/[id]/page.tsx` (CTA wiring)
- `web/src/app/stem/[tokenId]/page.tsx` (CTA wiring + catalog id capture)
- `web/src/lib/api.ts` (remix helpers)
- `backend/src/modules/contracts/metadata.controller.ts` (token metadata
  catalog ids)

### Executive Summary

The remix CTA slice adds no Critical or High findings. CTA states derive
exclusively from the authenticated eligibility API (fail-closed: the CTA
hides when eligibility is unknown or the request fails); the studio stub is
auth-gated and relies on the backend's owner-only project reads (403/404
render friendly states, no data leak); project creation sends no client
identity claims. The backend token-metadata addition exposes only catalog
UUIDs (`stem_id`, `track_id`, `release_id`) that the sibling
`:chainId/stem/:stemId` route and public listings payload already expose.

### Critical Findings

None.

### High Findings

None.

### Notes

- No `dangerouslySetInnerHTML`/`innerHTML`, exposed `NEXT_PUBLIC_*` secrets,
  cookie handling, or hardcoded non-localhost URLs in the changed slice.
- All remix API calls go through the shared `apiRequest` wrapper (Bearer
  token, central error handling, 401 session invalidation).
- Denial reasons rendered in tooltips come from the backend policy's fixed
  message strings, not user-generated content.

### Scans Run

- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/components/remix/ web/src/app/remix/`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/components/remix/ web/src/app/remix/ web/src/lib/api.ts`
- `rg 'document\.cookie|setCookie' web/src/components/remix/ web/src/app/remix/`
- Hardcoded non-localhost URL grep on new files
- `git diff --check`

## Remix Eligibility Service And Durable Remix Projects - 2026-06-09

### Scope Reviewed

Changed files (#892/#893, PR #1137):

- `backend/src/modules/remix/remix-eligibility.policy.ts`
- `backend/src/modules/remix/remix-eligibility.service.ts`
- `backend/src/modules/remix/remix-project.service.ts`
- `backend/src/modules/remix/remix.controller.ts`
- `backend/src/modules/remix/remix.module.ts`
- `backend/src/modules/remix/remix.service.ts`
- `backend/src/events/event_types.ts`
- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- `backend/prisma/schema.prisma` + migration `20260609120000_add_remix_project_models`
- remix test files under `backend/src/tests/`

### Executive Summary

The remix P0 slices add an explainable eligibility policy and durable,
owner-scoped remix project APIs. The scoped review found no Critical or High
findings: all routes are JWT-guarded, creator identity comes from the JWT
(this branch removes the legacy endpoint's trust of a body-supplied
`creatorId`), license proof is derived only from server-side purchase and
settlement records matched to the caller's own wallet, project reads/edits
enforce creator ownership, and analytics event payloads exclude user-supplied
titles and prompts.

### Critical Findings

None.

### High Findings

- SBPR-1137-01 (fixed in-branch): the x402 remix-license lookup initially
  matched any `X402Settlement` row with a remix-licensed listing and matching
  payer, including rows persisted with `status = contract_settlement_failed`
  for failed on-chain listing settlements. A failed purchase could therefore
  satisfy the remix license requirement. Fixed by filtering on
  `status = "download_granted"` and covered by an integration regression test
  seeding a failed settlement.

### Notes

- All seven `/remix` routes use `AuthGuard("jwt")`; the only `UseGuards`-free
  match in the controller is the import statement.
- Eligibility denial responses describe the source's rights state, which is
  already surfaced by public catalog behavior; they reveal nothing about other
  users' purchases or wallets.
- Wallet matching uses Prisma `mode: "insensitive"` equality on the caller's
  own wallet address — no client-supplied address is accepted.
- All database access goes through the Prisma client; no raw SQL, `eval`, or
  `JSON.parse` in the touched slice.
- Policy denials and license requirements emit compact governed events
  (`remix.policy_rejected`, `remix.license_required`) whose bridge mappings
  exclude titles/prompts.
- The deprecated in-memory `POST /remix/create` shim remains JWT-guarded and
  is tracked for removal with #894+.

### Scans Run

- `rg -i 'password|secret|api_key|private_key' backend/src/modules/remix/`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/remix/`
- `rg 'JSON\.parse|eval\(' backend/src/modules/remix/`
- Route/guard audit of `backend/src/modules/remix/remix.controller.ts`
- `git diff --check origin/main..HEAD`

## Marketplace Pricing Optimization Action Cards - 2026-06-08

### Scope Reviewed

Changed files:

- `backend/src/modules/analytics/analytics.service.ts`
- `backend/src/tests/analytics.spec.ts`
- `web/src/lib/api.ts`
- `web/src/components/analytics/ArtistAnalyticsDashboard.test.tsx`
- `docs/features/README.md`
- `docs/features/analytics_dashboard.md`
- `docs/issue-1134-marketplace-pricing-optimization-action-cards-plan.md`

### Executive Summary

Issue #1134 adds a deterministic `improve_marketplace_conversion` artist
action card from thresholded aggregate marketplace purchase intent and
artist-attributed settled-commerce facts. The scoped review found no Critical
or High findings: the card is server-derived, applies the existing five-signal
privacy floor to purchase-intent counts, links only to the existing marketplace
management surface, and does not expose buyer identities, wallet addresses,
raw checkout attempts, secrets, production URLs, or arbitrary redirect targets.

### Critical Findings

None.

### High Findings

None.

### Notes

- The card appears only when aggregate `marketplace.purchase_intent` reaches
  the artist action threshold and no `commerce.settled` facts are visible in
  the selected analytics window.
- The existing `review_marketplace_pricing` card remains the fallback when
  thresholded purchase intent and settled commerce are both visible.
- The recommendation is advisory; it does not auto-reprice listings, change
  license tiers, send messages, or mutate marketplace inventory.
- The action link is a fixed application route,
  `/marketplace/manage?status=active`.
- Targeted scanner output found no hardcoded secret, raw SQL, frontend XSS,
  client-exposed secret, or browser-cookie handling patterns in the touched
  slice. Existing analytics `JSON.parse` uses in warehouse/report code were not
  introduced or expanded by this branch.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/analytics backend/src/tests/analytics.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/analytics backend/src/tests/analytics.spec.ts`
- `rg 'JSON\.parse|eval\(' backend/src/modules/analytics backend/src/tests/analytics.spec.ts`
- `rg 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/lib/api.ts web/src/components/analytics/ArtistAnalyticsDashboard.test.tsx`

## Reward Early Supporters Action Card - 2026-06-08

### Scope Reviewed

Changed files:

- `backend/src/modules/analytics/analytics.service.ts`
- `backend/src/tests/analytics.spec.ts`
- `web/src/lib/api.ts`
- `web/src/components/analytics/ArtistAnalyticsDashboard.test.tsx`
- `docs/features/README.md`
- `docs/features/analytics_dashboard.md`
- `docs/issue-1132-reward-early-supporters-action-card-plan.md`

### Executive Summary

Issue #1132 adds a deterministic `reward_early_supporters` artist action card
from artist-attributed aggregate supporter role grants, with supporter-room
joins as a fallback signal. The scoped review found no Critical or High
findings: the card is server-derived, applies the existing five-signal privacy
floor, deep-links to the existing manual community benefit surface, and does
not expose supporter identities, wallet addresses, raw support proofs, private
room membership, secrets, production URLs, or arbitrary redirect targets.

### Critical Findings

None.

### High Findings

None.

### Notes

- The primary signal is `community.role_granted` where `roleType` is
  `supporter`; `community.campaign_room_joined` for
  `show_campaign_supporter` rooms is used only as fallback when role grants are
  absent.
- `community.badge_granted` is intentionally not counted to avoid double
  counting supporter badge and role grants emitted for the same campaign
  support proof.
- The action link is a fixed application route,
  `/artist/:artistId?tab=community`, encoded from the server-side artist
  dashboard request.
- The recommendation is advisory; it does not auto-send rewards, messages,
  payouts, benefits, or campaign updates.
- Targeted scanner output found no hardcoded secret, raw SQL, frontend XSS,
  client-exposed secret, or browser-cookie handling patterns in the touched
  slice. Existing analytics `JSON.parse` uses in warehouse/report code were not
  introduced or expanded by this branch.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/analytics backend/src/tests/analytics.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/analytics backend/src/tests/analytics.spec.ts`
- `rg 'JSON\.parse|eval\(' backend/src/modules/analytics backend/src/tests/analytics.spec.ts`
- `rg 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/lib/api.ts web/src/components/analytics/ArtistAnalyticsDashboard.test.tsx`

## Holder Benefit Action Card - 2026-06-08

### Scope Reviewed

Changed files:

- `backend/src/modules/analytics/analytics.service.ts`
- `backend/src/tests/analytics.spec.ts`
- `web/src/lib/api.ts`
- `web/src/components/analytics/ArtistAnalyticsDashboard.test.tsx`
- `docs/features/README.md`
- `docs/features/analytics_dashboard.md`
- `docs/issue-1121-holder-benefit-action-card-plan.md`

### Executive Summary

This #1121 follow-up adds a deterministic `create_holder_benefit` artist
action card from aggregate holder-room joins. The scoped review found no
Critical or High findings: the card is server-derived, applies the existing
five-signal privacy floor, suppresses repeated benefit-creation nudges when a
benefit-rule creation event is visible in the analytics window, and does not
expose holder identities, wallet addresses, private proof details, secrets,
production URLs, or arbitrary redirect targets.

### Critical Findings

None.

### High Findings

None.

### Notes

- The card uses aggregate `community.room_joined` facts for `artist_holder`
  rooms and compact `community.benefit_rule_created` lifecycle facts only.
- The action link is a fixed application route,
  `/artist/:artistId?tab=community`, encoded from the server-side artist
  dashboard request.
- The recommendation is advisory; it does not auto-create benefits or bypass
  the existing artist/operator benefit-rule authorization path.
- Targeted scanner output found no hardcoded secret, raw SQL, frontend XSS,
  client-exposed secret, or browser-cookie handling patterns in the touched
  slice. Existing analytics `JSON.parse` uses in warehouse/report code were not
  introduced or expanded by this branch.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/analytics backend/src/tests/analytics.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/analytics backend/src/tests/analytics.spec.ts`
- `rg 'JSON\.parse|eval\(' backend/src/modules/analytics backend/src/tests/analytics.spec.ts`
- `rg 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/lib/api.ts web/src/components/analytics/ArtistAnalyticsDashboard.test.tsx`

## Holder Benefit Rule Management - 2026-06-08

### Scope Reviewed

Changed files:

- `backend/src/events/event_types.ts`
- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- `backend/src/modules/community/community.controller.ts`
- `backend/src/modules/community/community_eligibility.service.ts`
- `backend/src/tests/analytics_domain_event_bridge.spec.ts`
- `backend/src/tests/community.controller.http.spec.ts`
- `backend/src/tests/community.controller.spec.ts`
- `backend/src/tests/community_eligibility.integration.spec.ts`
- `web/src/components/community/ArtistCommunityTab.tsx`
- `web/src/lib/api.ts`
- `web/src/app/globals.css`
- related feature catalog and issue-plan docs

### Executive Summary

Issue #1126 adds artist/operator management for community holder benefit rules.
The scoped review found no Critical or High findings: all new management
endpoints require JWT authentication and server-side artist/operator
authorization, rule policy JSON is normalized and scoped server-side, Prisma
queries remain structured, analytics lifecycle events are compact and
allowlisted, and management DTOs do not return wallet addresses, raw listener
proofs, raw policy internals, secrets, or production configuration.

### Critical Findings

None.

### High Findings

None.

### Notes

- `GET/POST /community/artists/:artistId/benefit-rules` and pause/expire routes
  are protected with `AuthGuard("jwt")`, then re-check artist owner/operator
  authority in `CommunityEligibilityService` using authenticated role context,
  not privileged-looking user IDs.
- Managed eligibility policies are limited to ownership, campaign support,
  badge, role, and bounded compound policies. Artist-scoped badge/role and
  ownership policies are normalized to the managed artist; track, stem, token,
  and campaign-support scopes are verified against the managed artist before a
  rule is stored.
- New lifecycle analytics only retain `artistId`, `benefitRuleId`,
  `benefitType`, and `status`; raw eligibility policy JSON is not bridged.
- Frontend additions use typed API helpers and controlled form inputs. No raw
  HTML rendering, browser cookie handling, or client-exposed secret variables
  were introduced.
- Broad scanner output still includes pre-existing repository patterns such as
  community moderation model-fallback key naming and analytics JSON parsing in
  existing warehouse/model paths. None are introduced or expanded by this
  branch.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/community backend/src/modules/analytics backend/src/events --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/community backend/src/modules/analytics backend/src/events`
- `rg 'JSON\.parse|eval\(' backend/src/modules/community backend/src/modules/analytics backend/src/events`
- `rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/community/community.controller.ts -n -C 1`
- `rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/community/community.controller.ts -n -C 1`
- `rg 'dangerouslySetInnerHTML|innerHTML|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/components/community web/src/lib/api.ts`

## Artist Action Marketplace Lifecycle Cards - 2026-06-08

### Scope Reviewed

Changed files:

- `backend/src/modules/analytics/analytics.controller.ts`
- `backend/src/modules/analytics/analytics.service.ts`
- `backend/src/modules/analytics/analytics_warehouse.ts`
- `backend/src/tests/analytics.controller.http.spec.ts`
- `backend/src/tests/analytics.spec.ts`
- `backend/src/tests/analytics_warehouse.spec.ts`
- `web/src/app/marketplace/page.tsx`
- `web/src/app/marketplace/manage/page.tsx`
- `web/src/components/analytics/ArtistAnalyticsDashboard.test.tsx`
- `web/src/components/marketplace/BuyModal.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/productAnalytics.ts`
- `web/src/lib/productAnalytics.test.ts`
- feature catalog, analytics feature page, and #1121 implementation plan docs

### Executive Summary

This #1121 follow-up adds marketplace lifecycle action cards for relisting
expired inventory and reviewing pricing after aggregate checkout intent. The
scoped review found no Critical or High findings: buyer marketplace events now
carry artist attribution from listing metadata, owner inventory analytics emit
only compact per-artist counts from the protected seller workspace, relist
cards point to the existing marketplace manager route, purchase-intent cards
still require the five-signal floor, and no raw buyer identity, seller wallet
address, private listing payload, secrets, production URLs, or arbitrary
redirect targets were introduced.

### Critical Findings

None.

### High Findings

None.

### Notes

- `marketplace.owner_inventory_viewed` is allowlisted as a first-party product
  analytics event and emits counts such as active, expired, expiring-soon,
  relistable, and total listings. It does not emit listing IDs or seller
  wallet addresses.
- Marketplace purchase-intent cards are derived only from events that include
  `artistId`; unattributed buyer-side events are not inferred into artist
  dashboards.
- Action-card links are fixed application routes:
  `/marketplace/manage?status=expired` and
  `/marketplace/manage?status=active`.
- Broad scanner output still includes pre-existing repository patterns such as
  local-dev JWT fallbacks, parameterized Prisma raw SQL elsewhere, and
  controller methods without DTO class pipes. None are introduced or expanded
  by this branch.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/`
- `rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/ | grep -v 'Guard\|Auth'`
- `rg 'JSON\.parse|eval\(' backend/src/`
- `rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/ | grep -v 'Pipe\|Dto\|Validation'`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/`
- `rg 'document\.cookie|setCookie|httpOnly.*false' web/src/`

## Artist Action Workflow Cards - 2026-06-08

### Scope Reviewed

Changed files:

- `backend/src/modules/analytics/analytics.service.ts`
- `backend/src/modules/analytics/analytics_warehouse.ts`
- `backend/src/tests/analytics.spec.ts`
- `web/src/components/analytics/ArtistAnalyticsDashboard.test.tsx`
- `web/src/lib/api.ts`
- `docs/features/README.md`
- `docs/features/analytics_dashboard.md`
- `docs/issue-1121-implementation-plan.md`

### Executive Summary

This #1121 follow-up extends deterministic artist action cards to existing
Shows, holder-room, and remix analytics signals. The scoped review found no
Critical or High findings: cards remain server-derived from artist-scoped
analytics facts, community/listener-derived counts use the existing five-signal
floor, unavailable Remix Studio challenge creation is represented as a disabled
card with a reason, and no raw listener identity, wallet addresses, private room
membership, secrets, production URLs, or arbitrary redirects were introduced.

### Critical Findings

None.

### High Findings

None.

### Notes

- Newly preserved warehouse dimensions are compact event fields already present
  in existing Shows/community/remix analytics events: campaign IDs/slugs, city
  labels, room type, benefit/remix IDs, and source track IDs.
- Action-card links are fixed application routes (`/shows/:idOrSlug` and
  `/artist/:id?tab=community`) derived from backend facts, not client-submitted
  action payloads.
- `prepare_remix_challenge` is intentionally disabled because Remix Studio
  challenge creation remains planned; the card avoids implying a live workflow.
- Broad scanner output still includes pre-existing repository patterns such as
  local-dev JWT fallbacks, parameterized Prisma raw SQL elsewhere, and
  controller methods without DTO class pipes. None are introduced or expanded
  by this branch.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/`
- `rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/ | grep -v 'Guard\|Auth'`
- `rg 'JSON\.parse|eval\(' backend/src/`
- `rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/ | grep -v 'Pipe\|Dto\|Validation'`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/`
- `rg 'document\.cookie|setCookie|httpOnly.*false' web/src/`

## Artist Action Cockpit - 2026-06-08

### Scope Reviewed

Changed files:

- `backend/src/modules/analytics/analytics.controller.ts`
- `backend/src/modules/analytics/analytics.service.ts`
- `backend/src/tests/analytics.controller.http.spec.ts`
- `backend/src/tests/analytics.spec.ts`
- `web/src/app/artist/[id]/page.tsx`
- `web/src/components/analytics/ArtistAnalyticsDashboard.tsx`
- `web/src/components/analytics/ArtistAnalyticsDashboard.test.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/productAnalytics.ts`
- related feature, taxonomy, and issue-plan docs

### Executive Summary

Issue #1121 adds a first deterministic artist action cockpit to the protected
artist analytics dashboard. The scoped review found no Critical or High
findings: action cards are derived server-side from artist-owned or aggregate
analytics signals, listener-derived cards apply a minimum signal threshold,
deep links are fixed application routes, and product analytics payloads are
compact allowlisted fields without raw listener identity, wallet addresses,
cohort membership, free text, secrets, or production configuration.

### Critical Findings

None.

### High Findings

None.

### Notes

- `GET /analytics/artist/:id/v1` remains protected by the existing artist/admin
  authorization check before the action cards are returned.
- The new action-card DTO does not trust client-submitted claims; frontend
  product analytics only records card impressions/clicks and cannot influence
  recommendations.
- The new community CTA uses the existing `/artist/:id?tab=community` route,
  and the artist page now reads the tab query string rather than accepting an
  arbitrary redirect.
- No new environment variables, hardcoded URLs, secrets, raw SQL, unsafe DOM
  HTML, cookie handling, or user-provided JSON parsing were introduced.
- Broad scanner output still includes pre-existing repository patterns such as
  local-dev JWT fallbacks, parameterized Prisma raw SQL elsewhere, and
  controller methods without DTO class pipes. None are introduced or expanded
  by this branch.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/`
- `rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/ | grep -v 'Guard\|Auth'`
- `rg 'JSON\.parse|eval\(' backend/src/`
- `rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/ | grep -v 'Pipe\|Dto\|Validation'`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/`
- `rg 'document\.cookie|setCookie|httpOnly.*false' web/src/`

## Discord Bridge - 2026-06-08

### Scope Reviewed

Changed files:

- `backend/prisma/schema.prisma`
- `backend/src/events/event_types.ts`
- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- `backend/src/modules/community/community.controller.ts`
- `backend/src/modules/community/community.module.ts`
- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/modules/community/community_discord_bridge.service.ts`
- `backend/src/tests/analytics_domain_event_bridge.spec.ts`
- `backend/src/tests/community.controller.spec.ts`
- `backend/src/tests/community_discord_bridge.integration.spec.ts`
- `web/src/components/community/ArtistCommunityTab.tsx`
- `web/src/components/community/ArtistCommunityTab.test.tsx`
- `web/src/lib/api.ts`
- `docs/architecture/listener_community_network.md`
- `docs/features/README.md`
- `docs/features/listener_community_network.md`
- `docs/issue-1002-implementation-plan.md`

### Executive Summary

Issue #1002 adds artist-controlled Discord bridge settings, public invite
display, announcement webhook mirroring, retry state, and aggregate role-sync
status. The scoped review found no Critical or High findings: webhook URLs are
validated and kept write-only, public DTOs expose only opt-in invite metadata,
analytics payloads exclude webhook secrets and member identifiers, and role sync
uses server-side `CommunityRole` aggregate counts rather than client-submitted
claims.

### Critical Findings

None.

### High Findings

None.

### Low Findings

#### SBPR-001: Discord webhook URLs are intentionally stored server-side

**File:** `backend/src/modules/community/community_discord_bridge.service.ts`
**Impact:** Discord webhook URLs are sensitive integration secrets and would
allow posting to an artist's Discord channel if exposed.
**Recommendation:** Current implementation keeps webhook URLs write-only in API
DTOs, stores only a masked value for UI display, clears the webhook on
disconnect, excludes webhook fields from analytics payloads, and validates
Discord webhook host/path before storage. Keep this boundary when adding future
operator dashboards, exports, logs, or support tooling.

### Notes

- Public Discord reads return only invite metadata when the artist enables
  `publicLinkEnabled`.
- Announcement mirror failures are retryable state and do not block native
  Resonate message creation.
- Role sync currently uses aggregate server-side `CommunityRole` counts only;
  no member identities or Discord user IDs are exposed.
- The changed code does not add raw SQL, unsafe DOM HTML usage, new public
  environment variables, or hardcoded production URLs.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/`
- `rg 'JSON\.parse|eval\(' backend/src/modules/community backend/src/modules/analytics backend/src/events`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/components/community web/src/lib/api.ts`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/components/community web/src/lib/api.ts`

## Marketplace Lifecycle Cross-Surface Audit - 2026-06-07

### Scope Reviewed

Changed files:

- `backend/src/modules/agents/tools/tool_registry.ts`
- `backend/src/modules/contracts/metadata.controller.ts`
- `backend/src/tests/agent_catalog_search.integration.spec.ts`
- `backend/src/tests/metadata.controller.integration.spec.ts`
- `docs/features/README.md`
- `docs/features/marketplace_listing_lifecycle.md`

### Executive Summary

Issue #1118 tightens marketplace listing availability across public detail and
agent recommendation surfaces. The scoped review found no Critical or High
findings: the new checks reuse Prisma structured filters and the shared
`isPubliclyPurchasableListing` predicate, fail closed for expired/sold-out
public listing detail reads, and do not introduce new secrets, raw SQL,
deserialization, environment configuration, or client-rendered HTML.

### Critical Findings

None.

### High Findings

None.

### Notes

- `GET /api/metadata/listings/:chainId/:listingId` remains a public marketplace
  detail read, but now returns `404` unless the listing is active, has
  remaining amount, and has a future `expiresAt`.
- Owner inventory remains available through authenticated
  `GET /api/metadata/listings/owner/:seller`, so expired listing history and
  relist affordances stay seller-visible without becoming public buyable
  inventory.
- AI DJ `catalog.search` now sets `hasListing` only from active, remaining,
  unexpired listings, preventing expired or sold-out rows from boosting tracks
  as purchasable.
- The changed code does not add raw SQL, new model calls, user-provided JSON
  parsing, secrets, production URLs, or new environment variables.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/`
- `rg 'JSON\.parse|eval\(' backend/src/`
- `rg '@Controller|@Get|@Post|@Put|@Delete|@Patch|UseGuards' backend/src/modules/contracts/metadata.controller.ts`
- `rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/contracts/metadata.controller.ts`
- `rg 'password|secret|api_key|private_key|rawQuery|executeRaw|\$queryRaw|JSON\.parse|eval\(' backend/src/modules/agents/tools/tool_registry.ts backend/src/modules/contracts/metadata.controller.ts --iglob '!*.test.*' --iglob '!*.spec.*'`

## Marketplace Listing Indexing State - 2026-06-07

### Scope Reviewed

Changed files:

- `backend/src/modules/contracts/contracts.service.ts`
- `backend/src/modules/contracts/metadata.controller.ts`
- `backend/src/tests/metadata.controller.integration.spec.ts`
- `web/src/app/marketplace/page.tsx`
- `web/src/components/marketplace/BatchMintListModal.tsx`
- `web/src/components/marketplace/BuyModal.tsx`
- `web/src/components/marketplace/MintStemButton.tsx`
- `web/src/hooks/useContracts.ts`
- `web/src/lib/api.ts`
- `web/src/lib/stemMarketplaceStatus.ts`

### Executive Summary

This bugfix narrows marketplace listing confirmation to backend-indexed active
listings and removes localStorage as an authoritative source for public listing
state. The scoped review found no Critical or High findings: the new `stemId`
filter is handled through Prisma structured filters, client-side local hints
are downgraded to pending/indexing state until backend confirmation, and no
new secrets, cookie handling, or HTML injection surfaces were introduced. The
listing notification path now carries the wallet transaction's explicit chain
ID and triggers the existing transaction indexer for that chain, avoiding
cross-chain env fallback mistakes. Marketplace listing list responses also
expose the indexed listing `chainId`, and the buy modal uses the indexed
listing snapshot for display while blocking direct wallet checkout when the
connected wallet chain does not match the listing chain.

### Critical Findings

None.

### High Findings

None.

### Notes

- `GET /metadata/listings` remains a public marketplace read endpoint; the new
  `stemId` query parameter only narrows public active listing results and does
  not expose private owner data.
- The frontend now treats wallet transaction success as `listing_pending` until
  `/metadata/listings?status=active&stemId=...` returns a confirmed listing.
- `POST /metadata/notify-listing` uses the notified `chainId` when present,
  stores the listing intent on that chain, and runs the existing receipt
  indexer for that exact transaction. If reindexing fails, it logs a warning and
  leaves the background indexer path intact.
- `BuyModal` no longer treats an empty direct contract read on the connected
  wallet chain as authoritative display data for an indexed listing from a
  different chain; it shows the indexed listing snapshot and requires the
  correct chain for direct wallet checkout.
- The existing Prisma tagged `$queryRaw` in `contracts.service.ts` is
  parameterized, outside this patch's marketplace listing path, and was not a
  finding.
- No environment-dependent configuration values, secrets, or production URLs
  were added.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/contracts backend/src/tests/metadata.controller.integration.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/contracts backend/src/tests/metadata.controller.integration.spec.ts`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/components/marketplace web/src/hooks/useContracts.ts web/src/lib/api.ts web/src/lib/stemMarketplaceStatus.ts`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD|document\.cookie|setCookie|httpOnly.*false' web/src/components/marketplace web/src/hooks/useContracts.ts web/src/lib/api.ts web/src/lib/stemMarketplaceStatus.ts`

## NFT-Verifiable Artist Holder Room Access - 2026-06-07

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_eligibility.service.ts`
- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/tests/community_eligibility.integration.spec.ts`
- `backend/src/tests/community_rooms.integration.spec.ts`
- `web/src/components/community/ArtistCommunityTab.tsx`
- `web/src/components/community/ArtistCommunityTab.test.tsx`
- `docs/features/README.md`
- `docs/features/listener_community_network.md`
- `docs/issue-1096-implementation-plan.md`

### Executive Summary

Issue #1096 uses existing indexed stem/NFT ownership as a private eligibility
input for artist holder rooms while keeping community membership, messages,
moderation state, and visibility off-chain. The scoped review found no Critical
or High findings: holder proof evaluation stays server-side, response DTOs
expose only bounded reason codes, unsupported ownership asset types fail
closed, and moderation bans/removals continue to override ownership.

### Critical Findings

None.

### High Findings

None.

### Notes

- `GET /community/artists/:artistId/rooms/me` and `POST /community/rooms/:roomId/join`
  remain JWT guarded for personalized holder access and membership writes.
- Public artist room listing still returns only non-personal public room access
  state; private holder eligibility is only evaluated for authenticated reads.
- Holder eligibility uses Prisma structured queries against indexed wallet,
  marketplace purchase, and marketplace resale state; no raw SQL or
  client-provided ownership claim is trusted.
- Artist holder memberships are reconciled off-chain, and stale ownership
  eligibility changes active memberships to `removed`.
- Existing moderation state remains stronger than ownership: a banned listener
  cannot rejoin a holder room even if ownership still exists.
- Holder-room DTOs and frontend copy do not expose wallet addresses, token IDs,
  purchase IDs, listing IDs, or exact ownership details.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/community backend/src/tests/community_*.integration.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/community backend/src/tests/community_*.integration.spec.ts`
- `rg 'JSON\.parse|eval\(' backend/src/modules/community backend/src/tests/community_*.integration.spec.ts`
- `rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/community`
- `rg '@Controller|@Get|@Post|@Put|@Delete|@Patch|UseGuards' backend/src/modules/community/community.controller.ts`
- `rg 'dangerouslySetInnerHTML|innerHTML|document\.cookie|setCookie|httpOnly.*false|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/components/community web/src/lib/api.ts`
- Targeted review of holder proof evaluation, artist-room access DTOs,
  membership reconciliation, moderation override behavior, frontend rendering,
  and feature documentation.

## AI-Native Moderation Assist - 2026-06-06

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/tests/community_rooms.integration.spec.ts`
- `backend/src/tests/maintenance.controller.http.spec.ts`
- `web/src/components/admin/CommunityModerationDashboard.tsx`
- `web/src/components/admin/CommunityModerationDashboard.test.tsx`
- `web/src/lib/api.ts`
- `docs/features/README.md`
- `docs/features/listener_community_network.md`
- `docs/issue-1083-implementation-plan.md`

### Executive Summary

Issue #1083 adds advisory moderation summaries and risk hints to the admin
community moderation queue. The scoped review found no Critical or High
findings: the assist is generated from the existing privacy-bounded moderation
DTO surface, remains read-only, does not add model calls or new environment
configuration, and cannot delete messages, ban members, pause/archive rooms, or
resolve reports without the existing explicit admin action flow.

### Critical Findings

None.

### High Findings

None.

### Notes

- `GET /admin/community/moderation/reports` remains guarded by JWT auth and
  admin role checks through `MaintenanceController`.
- The assist generator runs after moderation DTO hydration and consumes only
  report reason, room title/type/status, message preview/status/type, report
  counts, and membership status counts.
- No emails, wallet addresses, raw access-policy payloads, raw private listener
  data, or unbounded thread bodies are added to the response or sent to a model.
- Queue reads remain read-only; report, message, membership, and room state
  mutations still happen only through `resolveModerationReport` after a human
  admin chooses an action.
- The frontend renders assist text through React text nodes and keeps action
  buttons behind the existing confirmation flow.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/`
- `rg 'JSON\.parse|eval\(' backend/src/`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/`
- `rg 'document\.cookie|setCookie|httpOnly.*false' web/src/`
- `rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/community backend/src/modules/maintenance`
- `rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/community backend/src/modules/maintenance`
- Targeted review of the changed moderation DTO assist generation, admin route
  boundary, explicit human enforcement path, frontend rendering, and typed API
  contract.

## Opt-In Cohort Member Visibility - 2026-06-06

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_cohort.service.ts`
- `backend/src/tests/community_cohort.integration.spec.ts`
- `web/src/components/settings/ListenerCohortsPanel.tsx`
- `web/src/components/settings/ListenerCohortsPanel.test.tsx`
- `web/src/lib/api.ts`
- `web/src/app/globals.css`
- related feature docs, architecture docs, and issue plan

### Executive Summary

Issue #1070 adds capped cohort member previews for joined public/community
profiles while preserving anonymous treatment for private, follower-scoped,
suggested-only, left, hidden, consent-disabled, expired, archived, and
below-threshold members. The scoped review found no Critical or High findings:
membership visibility is selected server-side through authenticated cohort
detail gates, current profile visibility, current taste/city consent, joined
membership status, safe avatar URL validation, and bucketed aggregate count
copy.

### Critical Findings

None.

### High Findings

None.

### Notes

- `GET /community/cohorts/:cohortId` remains authenticated and continues to
  fail closed for hidden, left, expired, archived, below-threshold, and
  consent-disabled viewer states.
- Visible member previews require joined membership plus `public` or
  `community` profile visibility and matching consent for the cohort type.
- Community-visible profile previews are contextual summaries only; only public
  profiles receive public profile links or stable user identifiers.
- Private, followers-only, suggested-only, left, hidden, and consent-disabled
  members are omitted from preview DTOs and represented only by coarse
  anonymous copy.
- The frontend renders profile summary fields through React text rendering and
  does not introduce raw HTML rendering, direct cookie handling, client-side
  secret usage, or ad hoc API fetches.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/`
- `rg 'JSON\.parse|eval\(' backend/src/modules/community backend/src/tests/community_cohort.integration.spec.ts`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/components/settings web/src/lib/api.ts web/src/app/globals.css`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/`
- `rg 'document\.cookie|setCookie|httpOnly.*false' web/src/components/settings web/src/lib/api.ts`
- Targeted review of cohort membership gates, consent filters, profile
  visibility filters, redaction copy, count bucketing, avatar URL handling, and
  frontend rendering/API behavior.

## Cohort-Driven Discovery And AI DJ Context - 2026-06-06

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_cohort.service.ts`
- `backend/src/modules/recommendations/recommendations.service.ts`
- `backend/src/modules/agents/agent_selector.service.ts`
- `backend/src/modules/agents/agent_orchestrator.service.ts`
- `backend/src/modules/sessions/sessions.service.ts`
- `backend/src/events/event_types.ts`
- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- `web/src/app/page.tsx`
- `web/src/lib/api.ts`
- related tests, feature docs, analytics taxonomy docs, and issue plan

### Executive Summary

Issue #1072 adds joined cohort context as an additive, explainable discovery
signal for Home recommendations and AI DJ picks. The scoped review found no
Critical or High findings: cohort context is derived server-side from
authenticated joined memberships, current consent settings, visible cohort
lifecycle state, and minimum-size gates; recommendation and agent analytics use
aggregate cohort influence metadata and omit listener identities, wallet data,
raw listening history, and exact raw membership details.

### Critical Findings

None.

### High Findings

None.

### Notes

- `CommunityCohortService.getDiscoveryContextForUser()` returns only joined,
  consented, active/suggested, unexpired cohorts that meet minimum visible
  size.
- Suggested-only, left, hidden, stale, archived, expired, below-threshold, and
  consent-disabled cohorts fail closed for discovery influence.
- Recommendation and AI DJ explanation strings use bounded cohort labels and
  reason codes, not member lists or raw eligibility facts.
- `cohortInfluence` event metadata is aggregate-only and intentionally excludes
  other listener identities, wallets, raw histories, and exact membership
  details.
- The frontend uses centralized typed API helpers and React text rendering; no
  raw HTML rendering, direct cookie handling, or public secret environment
  variable usage was introduced.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\$queryRaw' backend/src/`
- `rg 'JSON\.parse|eval\(' backend/src/`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/`
- `rg 'document\.cookie|setCookie|httpOnly.*false' web/src/`
- Targeted review of membership gating, consent/lifecycle filters, analytics
  payload shape, recommendation explanation copy, and frontend rendering/API
  behavior.

## Community Cohort Scoped Rooms - 2026-06-05

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community.controller.ts`
- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/tests/community.controller.http.spec.ts`
- `backend/src/tests/community.controller.spec.ts`
- `backend/src/tests/community_cohort.integration.spec.ts`
- `web/src/components/settings/ListenerCohortsPanel.tsx`
- `web/src/lib/api.ts`
- related frontend tests, feature docs, architecture docs, and issue plan

### Executive Summary

Issue #1071 adds cohort-scoped community rooms for joined listener cohorts. The
scoped review found no Critical or High findings: the new routes are JWT
guarded, room exposure and membership writes are enforced server-side against
current cohort membership, consent, lifecycle, expiry, and minimum-size gates,
Prisma structured queries are used instead of raw SQL, and the response shape
avoids private listener identity leakage by redacting other cohort message
authors and omitting member lists, wallets, raw histories, and raw eligibility
metadata.

### Critical Findings

None.

### High Findings

None.

### Notes

- `GET /community/cohorts/:cohortId/room` and
  `POST /community/cohorts/:cohortId/room/join` run through
  `AuthGuard("jwt")`.
- Cohort room reads, joins, and direct room access require
  `CommunityCohortMembership.status = joined`; suggested, left, hidden, stale,
  expired, archived, below-threshold, and disabled-consent cohorts fail closed.
- Cohort rooms reuse the existing community message, report, and moderation
  primitives, so reported cohort messages surface through the admin moderation
  queue.
- Other cohort message authors are returned as generic cohort members, while
  the current viewer can identify only their own messages.
- The frontend uses centralized typed API helpers and React text rendering; no
  raw HTML rendering, direct cookie handling, or public secret environment
  variable usage was introduced.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/community backend/src/tests/community* --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\\$queryRaw' backend/src/modules/community backend/src/tests/community*`
- `rg 'JSON\\.parse|eval\\(' backend/src/modules/community web/src/components/settings/ListenerCohortsPanel.tsx web/src/lib/api.ts`
- `rg 'dangerouslySetInnerHTML|innerHTML|document\\.cookie|setCookie|httpOnly.*false|NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/components/settings/ListenerCohortsPanel.tsx web/src/lib/api.ts`
- Targeted review of JWT protection, cohort membership gating, consent and
  lifecycle gates, message author redaction, report/moderation reuse, and
  frontend rendering/API behavior.

## Community Governance Moderation Dashboard - 2026-06-05

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/modules/maintenance/maintenance.controller.ts`
- `backend/src/modules/maintenance/maintenance.service.ts`
- `backend/src/tests/community_rooms.integration.spec.ts`
- `backend/src/tests/maintenance.controller.http.spec.ts`
- `web/src/app/admin/community/moderation/page.tsx`
- `web/src/components/admin/CommunityModerationDashboard.tsx`
- `web/src/components/admin/CommunityModerationDashboard.test.tsx`
- `web/src/lib/api.ts`
- `web/src/lib/api.test.ts`
- related feature, strategy, checklist, and architecture docs

### Executive Summary

Issue #1037 adds an admin-only community moderation queue and governance
dashboard for reported community messages, room state, and moderation actions.
The scoped review found no Critical or High findings: the new admin endpoints
are JWT and admin-role guarded, use Prisma structured queries only, normalize
query/body inputs, avoid raw HTML rendering, and return bounded moderation
context without wallet addresses, user emails, raw access-policy payloads, or
full room history.

### Critical Findings

None.

### High Findings

None.

### Notes

- `GET /admin/community/moderation/reports` and
  `PATCH /admin/community/moderation/reports/:reportId` run through
  `AuthGuard("jwt")` and `RolesGuard` with `@Roles("admin")`.
- Report queue filters and resolution actions are normalized against explicit
  allow-lists before use.
- Admin resolution writes are scoped to the reported room/message context and
  support dismiss, delete message, remove member, ban member, pause room, and
  archive room.
- The moderation DTO returns message previews and membership-count context but
  omits user emails, wallet addresses, raw access-policy JSON, and full room
  history.
- The frontend uses centralized typed API helpers and React text rendering; no
  `dangerouslySetInnerHTML`, `innerHTML`, cookie handling, or public secret
  environment variable usage was introduced.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/community backend/src/modules/maintenance web/src/app/admin/community/moderation web/src/components/admin/CommunityModerationDashboard.tsx web/src/lib/api.ts --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\\$queryRaw' backend/src/modules/community backend/src/modules/maintenance`
- `rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/community backend/src/modules/maintenance`
- `rg 'JSON\\.parse|eval\\(' backend/src/modules/community backend/src/modules/maintenance`
- `rg '@Body\\(\\)|@Query\\(\\)|@Param\\(\\)' backend/src/modules/community backend/src/modules/maintenance`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/app/admin/community/moderation web/src/components/admin/CommunityModerationDashboard.tsx web/src/lib/api.ts`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/app/admin/community/moderation web/src/components/admin/CommunityModerationDashboard.tsx web/src/lib/api.ts`
- `rg 'document\\.cookie|setCookie|httpOnly.*false' web/src/app/admin/community/moderation web/src/components/admin/CommunityModerationDashboard.tsx web/src/lib/api.ts`
- Targeted review of admin authorization, queue filtering, resolution action
  allow-lists, moderation DTO redaction, and frontend API/rendering behavior.

## Community Cohort Detail Utility - 2026-06-03

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community.controller.ts`
- `backend/src/modules/community/community_cohort.service.ts`
- `backend/src/tests/community.controller.http.spec.ts`
- `backend/src/tests/community_cohort.integration.spec.ts`
- `web/src/components/settings/ListenerCohortsPanel.tsx`
- `web/src/lib/api.ts`
- `docs/features/*`
- `docs/architecture/listener_community_network.md`

### Executive Summary

Issue #1069 adds an authenticated listener cohort detail read and settings UI.
The scoped review found no Critical or High findings: the endpoint is JWT
guarded, reuses the existing membership, consent, lifecycle, expiry, and
minimum-size gates, and the detail response redacts other listener identities,
wallet addresses, exact private membership details, and raw listening history.

### Critical Findings

None.

### High Findings

None.

### Notes

- `GET /community/cohorts/:cohortId` is protected with
  `@UseGuards(AuthGuard("jwt"))`.
- Detail reads call the same `requireActionableMembership` path used by cohort
  actions, with allowed membership statuses narrowed to `suggested` and
  `joined`.
- Hidden, left, archived, expired, below-threshold, and disabled-consent cohorts
  fail closed; integration tests cover those cases.
- The detail DTO omits raw `visibleMemberCount` and `minimumSize` fields while
  returning bucketed member-count copy and explicit privacy redactions.
- The frontend uses the centralized typed API helper and does not introduce
  raw HTML rendering, direct token handling, or ad hoc backend URLs.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/ --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\\$queryRaw' backend/src/`
- `rg 'dangerouslySetInnerHTML|innerHTML' web/src/`
- `rg 'NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_.*KEY|NEXT_PUBLIC_.*PASSWORD' web/src/`
- `rg -n '@Controller|@Get|@Post|@Put|@Delete|@Patch|UseGuards|AuthGuard|@Param|@Body|@Query|\\$queryRaw|\\$executeRaw|JSON\\.parse|eval\\(' backend/src/modules/community/community.controller.ts backend/src/modules/community/community_cohort.service.ts`
- Targeted review of the cohort detail authorization path, consent checks,
  lifecycle visibility filters, response redaction, and frontend API usage.

## Community Cohort Operator Quality Analytics - 2026-06-03

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_cohort_quality.service.ts`
- `backend/src/modules/community/community.module.ts`
- `backend/src/modules/maintenance/maintenance.controller.ts`
- `backend/src/modules/maintenance/maintenance.service.ts`
- `backend/src/tests/community_cohort_quality.integration.spec.ts`
- `backend/src/tests/maintenance.controller.http.spec.ts`
- `docs/features/*`
- `docs/architecture/listener_community_network.md`

### Executive Summary

Issue #1064 adds an admin-only aggregate quality report for taste/community
cohorts. The scoped review found no Critical or High findings: the endpoint is
JWT and admin-role guarded through the existing maintenance controller, uses
Prisma structured aggregate/read queries only, does not introduce writes or
external calls, and returns operational counts without listener identifiers,
wallet addresses, raw listening history, purchase addresses, or fine location.

### Critical Findings

None.

### High Findings

None.

### Notes

- The report exposes cohort lifecycle, generated-cohort lifecycle, membership
  status, stale membership, disabled-consent, action-event, cohort-type, and
  reason-code health as aggregate metrics.
- Reason-code summaries are bounded to a small operator list and use member
  count buckets instead of exact visible listener counts.
- Disabled-consent filtering is counted from current visibility settings but
  never returns affected user IDs.
- Analytics action counts come from the existing `AnalyticsEvent` ledger for
  `community.cohort_suggested`, `community.cohort_joined`,
  `community.cohort_left`, and `community.cohort_hidden`.

### Scans Run

- `rg -n 'password|secret|api_key|private_key' backend/src/modules/community/community_cohort_quality.service.ts backend/src/modules/maintenance/maintenance.controller.ts backend/src/modules/maintenance/maintenance.service.ts backend/src/tests/community_cohort_quality.integration.spec.ts backend/src/tests/maintenance.controller.http.spec.ts`
- `rg -n 'rawQuery|executeRaw|\\$queryRaw' backend/src/modules/community/community_cohort_quality.service.ts backend/src/modules/maintenance/maintenance.controller.ts backend/src/modules/maintenance/maintenance.service.ts backend/src/tests/community_cohort_quality.integration.spec.ts backend/src/tests/maintenance.controller.http.spec.ts`
- `rg -n 'JSON\\.parse|eval\\(' backend/src/modules/community/community_cohort_quality.service.ts backend/src/modules/maintenance/maintenance.controller.ts backend/src/modules/maintenance/maintenance.service.ts backend/src/tests/community_cohort_quality.integration.spec.ts backend/src/tests/maintenance.controller.http.spec.ts`
- Targeted review of admin authorization, aggregate-only response shape,
  reason-code bounding, member-count bucketing, disabled-consent counting, and
  analytics event aggregation.

## Community Cohort Lifecycle Refresh - 2026-06-02

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_cohort_generation.service.ts`
- `backend/src/tests/community_cohort_generation.integration.spec.ts`
- `docs/features/*`
- `docs/architecture/listener_community_network.md`

### Executive Summary

Issue #1059 adds lifecycle refresh behavior to generated listener community
cohorts. The scoped review found no Critical or High findings: refresh remains
admin-triggered through the existing guarded maintenance endpoint, uses Prisma
structured queries only, keeps membership reconciliation consent and
minimum-size gated, and makes stale/expired/archived serving state explicit
before listener suggestions are exposed.

### Critical Findings

None.

### High Findings

None.

### Notes

- Generated cohorts are marked `active` only when their visible member count
  meets `minimumSize`.
- Generated cohorts below `minimumSize` are marked `archived`, so they remain
  unavailable to listener suggestion and join flows.
- Generated cohorts with no current eligible visible members are marked
  `expired`; previously visible suggested memberships are moved to `stale`,
  while previously joined memberships are moved to `stale_joined` so explicit
  join intent can be restored on requalification.
- Hidden and left user-intent memberships remain preserved across refresh and
  are not resurrected by generation.
- System-managed stale memberships can be restored only when a listener
  qualifies again through current consent and product state; `stale` restores
  to `suggested`, while `stale_joined` restores to `joined`.
- Admin refresh output remains aggregate-only and does not return listener IDs,
  wallet addresses, raw listening histories, purchase addresses, or private
  location details.

### Scans Run

- `rg -n 'password|secret|api_key|private_key' backend/src/modules/community/community_cohort_generation.service.ts backend/src/tests/community_cohort_generation.integration.spec.ts`
- `rg -n 'rawQuery|executeRaw|\\$queryRaw' backend/src/modules/community/community_cohort_generation.service.ts backend/src/tests/community_cohort_generation.integration.spec.ts`
- `rg -n 'JSON\\.parse|eval\\(' backend/src/modules/community/community_cohort_generation.service.ts backend/src/tests/community_cohort_generation.integration.spec.ts`
- Targeted review of lifecycle state transitions, stale membership handling,
  hidden/left preservation, generated metadata, and listener-serving filters.

## Community Cohort Generation Worker - 2026-06-02

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_cohort_generation.service.ts`
- `backend/src/modules/community/community.module.ts`
- `backend/src/modules/maintenance/maintenance.controller.ts`
- `backend/src/modules/maintenance/maintenance.module.ts`
- `backend/src/modules/maintenance/maintenance.service.ts`
- `backend/src/tests/community_cohort_generation.integration.spec.ts`
- `backend/src/tests/maintenance.controller.http.spec.ts`
- `docs/features/*`
- `docs/architecture/listener_community_network.md`

### Executive Summary

Issue #1054 adds an admin-triggered cohort generation worker for the listener
community network. The scoped review found no Critical or High findings: the
endpoint is JWT and admin-role guarded, the worker uses Prisma structured
queries only, cohort membership generation is consent gated, generated metadata
stores aggregate cohort signals rather than listener identities, and suspicious
source labels are collapsed before they can become cohort titles or reason
codes.

### Critical Findings

None.

### High Findings

None.

### Notes

- Taste, artist-affinity, collector, and campaign cohorts require
  `allowTasteMatching`; city-scene cohorts require `allowCityScenes`.
- Generated memberships preserve prior `hidden`, `left`, or `joined` state and
  do not resurrect hidden listeners into visible suggestions.
- Previously visible memberships that no longer qualify for a generated cohort
  are marked `stale` before `visibleMemberCount` is recomputed, so stale data
  cannot keep a cohort above the minimum-size privacy threshold.
- Cohorts below `minimumSize` are materialized for admin observability but are
  not visible or joinable through the listener suggestion API.
- The admin response exposes cohort-level aggregate counts only; it does not
  return listener IDs, wallet addresses, exact listening histories, purchase
  addresses, or private location details.
- The new label-sanitization regression test covers wallet-like source text so
  unsafe catalog/user-entered labels do not leak into generated cohort titles,
  explanations, or reason codes.
- Lifecycle refresh, cohort archival, scheduled execution, and operator quality
  metrics remain tracked as follow-up work under #1001.

### Scans Run

- `rg -n 'password|secret|api_key|private_key' backend/src/modules/community/community_cohort_generation.service.ts backend/src/modules/maintenance/maintenance.controller.ts backend/src/modules/maintenance/maintenance.service.ts backend/src/modules/community/community.module.ts backend/src/modules/maintenance/maintenance.module.ts`
- `rg -n 'rawQuery|executeRaw|\\$queryRaw' backend/src/modules/community/community_cohort_generation.service.ts backend/src/modules/maintenance/maintenance.controller.ts backend/src/modules/maintenance/maintenance.service.ts backend/src/modules/community/community.module.ts backend/src/modules/maintenance/maintenance.module.ts`
- `rg -n 'JSON\\.parse|eval\\(' backend/src/modules/community/community_cohort_generation.service.ts backend/src/modules/maintenance/maintenance.controller.ts backend/src/modules/maintenance/maintenance.service.ts backend/src/modules/community/community.module.ts backend/src/modules/maintenance/maintenance.module.ts`
- `rg -n '@Post|@Body|UseGuards|Roles' backend/src/modules/maintenance/maintenance.controller.ts`
- Targeted review of consent gates, admin authorization, minimum-size
  enforcement, metadata shape, prior-membership preservation, and generated
  label sanitization.

## Taste Cohort Backend Contract - 2026-06-01

### Scope Reviewed

Changed files:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260601203000_community_taste_cohorts/migration.sql`
- `backend/src/modules/community/community_cohort.service.ts`
- `backend/src/modules/community/community.controller.ts`
- `backend/src/events/event_types.ts`
- `backend/src/modules/analytics/*`
- `backend/src/tests/community_cohort.integration.spec.ts`
- `docs/features/*`
- `docs/architecture/listener_community_network.md`

### Executive Summary

Issue #1001 adds the first backend contract for opt-in taste cohorts. The scoped
review found no Critical or High findings: cohort suggestions are membership
backed, consent gated, minimum-size gated, off-chain, and return cohort-level
explanations without exposing other listener identities, raw listening history,
wallet data, ownership data, or private location facts.

### Critical Findings

None.

### High Findings

None.

### Notes

- Taste, artist-affinity, collector, and campaign cohorts require
  `allowTasteMatching`; city-scene cohorts require `allowCityScenes`.
- Cohorts below `minimumSize`, expired cohorts, archived cohorts, hidden
  memberships, and disabled-consent cohorts are not exposed.
- Cohort analytics payloads include cohort id/type, reason code, membership
  status, minimum size, and visible member count only.
- Membership is mutable and off-chain; join, leave, and hide do not create
  wallet, contract, or custody side effects.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/community backend/src/tests/community_cohort.integration.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\\$queryRaw' backend/src/modules/community backend/src/tests/community_cohort.integration.spec.ts`
- `rg 'JSON\\.parse|eval\\(' backend/src/modules/community backend/src/tests/community_cohort.integration.spec.ts`
- Targeted review of consent gates, minimum-size filtering, explanation
  sanitization, analytics payload allowlists, and off-chain membership actions.

## Campaign Support Lifecycle Reconciliation - 2026-06-01

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_eligibility.service.ts`
- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/modules/community/community.service.ts`
- `backend/src/tests/community_eligibility.integration.spec.ts`
- `backend/src/tests/community_rooms.integration.spec.ts`
- `backend/src/tests/community_profile.integration.spec.ts`
- `docs/features/*`

### Executive Summary

Issue #1048 changes authorization-sensitive campaign supporter access and
public support display. The scoped review found no Critical or High findings:
invalid refund, failure, cancellation, and refund-only lifecycle states now
stop granting private room access, private supporter proofs, and public
campaign-support cards.

### Critical Findings

None.

### High Findings

None.

### Notes

- Private supporter room reads now re-check eligibility before exposing
  messages and mark stale memberships `removed`.
- Supporter badges/roles remain private proofs and are revoked with `revokedAt`
  when support is no longer lifecycle-valid.
- Public profile support cards use the same lifecycle-valid support filters and
  do not expose pledge amount, wallet address, transaction hash, or private
  support history.

### Scans Run

- `rg 'password|secret|api_key|private_key' backend/src/modules/community backend/src/tests/community_*.integration.spec.ts --iglob '!*.test.*' --iglob '!*.spec.*'`
- `rg 'rawQuery|executeRaw|\\$queryRaw' backend/src/modules/community backend/src/tests/community_*.integration.spec.ts`
- `rg 'JSON\\.parse|eval\\(' backend/src/modules/community backend/src/tests/community_*.integration.spec.ts`
- Targeted review of campaign support policy filtering, proof revocation,
  private room read authorization, and public profile redaction behavior.

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

## Shows Campaign Conversion Analytics - 2026-06-01

### Scope Reviewed

Changed files:

- `backend/src/events/event_types.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260601172000_community_campaign_update_read_state/migration.sql`
- `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- `backend/src/modules/analytics/analytics_event.ts`
- `backend/src/modules/analytics/analytics_warehouse.ts`
- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/tests/analytics_event.spec.ts`
- `backend/src/tests/analytics_domain_event_bridge.spec.ts`
- `backend/src/tests/analytics_warehouse.spec.ts`
- `backend/src/tests/community_rooms.integration.spec.ts`
- `test-fixtures/analytics_expected_events.json`
- `workers/analytics-dataflow/analytics_transform.py`
- `workers/analytics-dataflow/test_analytics_transform.py`
- feature and architecture docs

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Campaign/community conversion analytics now include campaign id/slug/status,
  room references, artist id, and coarse campaign city/country only.
- `community.campaign_update_viewed` records the latest visible campaign update
  id and visible update count only when the latest seen update advances for
  that room member; update bodies remain excluded.
- Analytics bridge tests assert that message bodies, raw location source data,
  wallet holdings, private support history, and pledge amounts are not persisted
  in analytics payloads.
- Backend warehouse export and the Dataflow worker both accept the `community`
  analytics event family so campaign/community conversion events do not land in
  quarantine.
- No raw SQL, hardcoded secrets, unsafe deserialization, direct HTML injection,
  cookie handling, or new environment variables were introduced.
- Secret-scan hits were existing documentation references about redaction and
  operational secret handling, not committed credentials.
- JSON parsing hits were existing analytics warehouse/report parsing paths, not
  changed by this slice.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key|BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY' backend/src/modules/community backend/src/modules/analytics backend/src/events/event_types.ts docs/features docs/architecture --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|\$executeRaw|JSON\.parse|eval\(' backend/src/modules/community backend/src/modules/analytics backend/src/events/event_types.ts
git diff --check
python3 -m pytest -s workers/analytics-dataflow/test_analytics_transform.py
```

## Release Artist Community Room Provisioning - 2026-06-01

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/tests/community_rooms.integration.spec.ts`
- `docs/features/README.md`
- `docs/features/listener_community_network.md`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Public artist room reads can now provision default rooms only for artist
  profiles that already have a ready or published public official release via
  the same release-credit criteria used by public artist catalog pages.
- The automatic path does not publish `community.artist_tab_enabled` and does
  not grant manager or uploader moderation rights to unclaimed public artists.
- Holder-room access remains evaluated privately through the existing ownership
  or role policy. The public response still exposes only the safe lock reason.
- No schema change, data migration, raw SQL, hardcoded secrets, unsafe
  deserialization, direct HTML injection, cookie handling, or new environment
  variables were introduced.

### Commands Run

```bash
rg 'password|secret|api_key|private_key' backend/src/modules/community backend/src/modules/catalog --iglob '!*.test.*' --iglob '!*.spec.*'
rg 'rawQuery|executeRaw|\$queryRaw' backend/src/modules/community backend/src/modules/catalog
rg '@Controller|@Get|@Post|@Put|@Delete|@Patch' backend/src/modules/community backend/src/modules/catalog
rg 'JSON\.parse|eval\(' backend/src/modules/community backend/src/modules/catalog
rg '@Body\(\)|@Query\(\)|@Param\(\)' backend/src/modules/community backend/src/modules/catalog
```

## Model-Backed Community Moderation Assist - 2026-06-07

### Scope Reviewed

Changed files:

- `backend/src/modules/community/community_moderation_assist.service.ts`
- `backend/src/modules/community/community_rooms.service.ts`
- `backend/src/modules/community/community.module.ts`
- `backend/src/tests/community_moderation_assist.spec.ts`
- `backend/src/tests/community_rooms.integration.spec.ts`
- `backend/src/tests/community_cohort.integration.spec.ts`
- `web/src/lib/api.ts`
- `docs/deployment/environment.md`
- `docs/features/README.md`
- `docs/features/listener_community_network.md`

### Findings

- Critical: none.
- High: none.
- Medium: none introduced.
- Low: none introduced.

### Notes

- Community moderation assist now has an explicit backend service boundary.
  Deterministic assist remains the default deployed mode; model-backed summaries
  require `COMMUNITY_MODERATION_ASSIST_STRATEGY=model-assisted` plus existing
  `GOOGLE_AI_API_KEY` credentials.
- Model prompts use only bounded report reason, room title/type/status, message
  preview/status/type, aggregate report counts, and membership status counts.
  Reporter ids, message author ids, emails, wallet-like strings, raw access
  policy payloads, and full unbounded message bodies are excluded or redacted
  before the model call.
- Model output is post-validated against safe severity/likelihood enums and
  known reason codes. Missing credentials, timeout, malformed JSON, invalid
  shape, or rejected output falls back to deterministic assist.
- Model-backed queue hydration is capped per response and guarded by a
  per-process concurrency limiter so an admin queue read cannot fan out across
  the full report limit.
- The human-confirmation boundary is unchanged: assist remains advisory and
  cannot delete messages, ban members, pause/archive rooms, or resolve reports.
- The only new environment variables are documented in
  `docs/deployment/environment.md`; no secrets or environment-specific URLs were
  hardcoded.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key|BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY' backend/src/modules/community/community_moderation_assist.service.ts backend/src/modules/community/community_rooms.service.ts backend/src/tests/community_moderation_assist.spec.ts docs/deployment/environment.md docs/features/listener_community_network.md --iglob '!*.test.*' --iglob '!*.spec.*'
rg -n 'rawQuery|executeRaw|\$queryRaw|\$executeRaw|eval\(' backend/src/modules/community/community_moderation_assist.service.ts backend/src/modules/community/community_rooms.service.ts backend/src/tests/community_moderation_assist.spec.ts
rg -n 'JSON\.parse' backend/src/modules/community/community_moderation_assist.service.ts backend/src/modules/community/community_rooms.service.ts backend/src/tests/community_moderation_assist.spec.ts
git diff --check
cd backend && npx jest --runInBand src/tests/community_moderation_assist.spec.ts
cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='community_rooms.integration'
cd backend && npm run lint
cd web && npm run lint
```

## Scan: feat/1121-remix-challenge-card (2026-06-11)

**Scope:** `backend/src/modules/remix/remix-project.service.ts`,
`backend/src/modules/analytics/analytics.service.ts`,
`backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`,
plus test and docs changes for issue #1121 (enable the
`prepare_remix_challenge` artist action card on Remix Studio signals).

**Findings:** none (no Critical/High/Medium/Low).

### Review Notes

- No new endpoints, guards, or authorization paths. The card is derived
  server-side inside the existing authorized artist dashboard flow; clients
  cannot submit ownership, demand, or signal claims (unchanged trust model).
- New data flow is limited to the source release's `artistId` — a public
  catalog identifier — added to the internal `remix.project_created` event
  payload and forwarded by the analytics bridge's `compactPayload` whitelist.
  No listener identity, wallet, or cohort data is added; the remixer's
  `creatorId` exposure is unchanged from the pre-existing event.
- Privacy posture preserved: the card keeps the ≥5 aggregate-signal floor,
  and a new regression test proves unattributed `remix.project_created`
  events (missing `artistId`) aggregate under `unknown` and never surface in
  any artist's cockpit.
- The enabled card's deep link is a constant relative path
  (`/marketplace/manage?status=active`) — no interpolation of
  signal-derived values into hrefs for this card; sibling cards that do
  interpolate already wrap values in `encodeURIComponent`.
- No secrets, raw SQL, `eval`, or unsafe deserialization introduced; no
  environment variables added.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key|\$queryRaw|executeRaw|JSON\.parse|eval\(' \
  backend/src/modules/analytics/analytics.service.ts \
  backend/src/modules/analytics/analytics_domain_event_bridge.service.ts \
  backend/src/modules/remix/remix-project.service.ts
rg -n 'href: `' backend/src/modules/analytics/analytics.service.ts
git diff --check
cd backend && npm run test           # 765 passed
cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='remix.integration'  # 26 passed
cd backend && npm run lint           # tsc clean
cd web && npx vitest run             # 438 passed
```

## Scan: feat/1143-remix-product-analytics (2026-06-11)

**Scope:** `backend/src/modules/analytics/analytics.controller.ts` (allow-list
extension), `web/src/lib/productAnalytics.ts`,
`web/src/components/remix/RemixCta.tsx`,
`web/src/components/remix/RemixStudioEditor.tsx`, tests and docs for issue
#1143 (remix CTA + studio funnel product analytics).

**Findings:** none (no Critical/High/Medium/Low).

### Review Notes

- Five new event names added to the authenticated product-analytics
  allow-list; the deny-by-default posture is unchanged and regression-tested
  (`remix.prompt_typed` rejected with 400).
- Payloads are compact identifiers and enum codes only: track/stem/project
  ids, CTA state, variant, click outcome, mode, stem count, and stable
  `reasonCode` strings. No titles, prompts, free-text reasons, wallets, or
  listener identities are emitted; the prompt box content is never sent.
- The endpoint requires authentication, so anonymous (signed-out) traffic is
  not recordable — documented as a limitation rather than worked around with
  an unauthenticated path.
- No new endpoints, guards, secrets, raw SQL, or environment variables.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key|\$queryRaw|executeRaw|eval\(' \
  backend/src/modules/analytics/analytics.controller.ts \
  web/src/lib/productAnalytics.ts \
  web/src/components/remix/RemixCta.tsx \
  web/src/components/remix/RemixStudioEditor.tsx
git diff --check
cd backend && npm run test   # 767 passed (incl. new controller contract tests)
cd backend && npm run lint   # tsc clean
cd web && npx vitest run     # 441 passed
cd web && npm run build      # pass
```

## Scan: fix/1144-remix-rate-limit (2026-06-11)

**Scope:** `backend/src/modules/remix/remix-project.service.ts` (per-user
sliding-window rate limits on remix project creation and generation),
integration tests, env/feature docs for issue #1144.

**Findings:** none (no Critical/High/Medium/Low).

### Review Notes

- Closes a pre-public-launch abuse gap from the change-impact checklist:
  authenticated users could create unbounded RemixProject rows and spam the
  (config-disabled) generation endpoint. Limits are enforced before any
  eligibility/database work, so throttled callers cost nothing downstream.
- Denied attempts consume the caller's budget (requests counted, not
  successes), preventing probe loops against the eligibility policy.
- Limits are per-user in-memory sliding windows keyed by action+userId —
  same trade-off as the existing catalog generation limiter (resets on
  restart, per-instance on horizontal scale); acceptable for current
  single-instance Cloud Run deployment and documented in the PR.
- HTTP 429 (not the catalog's 400) so agents and the frontend can
  distinguish throttling from invalid input; messages contain the ceiling
  and no sensitive data.
- New env vars (`REMIX_PROJECT_RATE_LIMIT`, `REMIX_GENERATION_RATE_LIMIT`)
  are optional with safe defaults and documented in
  `docs/deployment/environment.md`; no secrets, raw SQL, or new endpoints.

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key|\$queryRaw|executeRaw|eval\(' \
  backend/src/modules/remix/remix-project.service.ts
git diff --check
cd backend && npm run test  # 767 passed
cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='remix.integration'  # 28 passed
cd backend && npm run lint  # tsc clean
```

## Scan: feat/1162-remix-lyria-provider (2026-06-11)

**Scope:** `backend/src/modules/remix/lyria-remix-generation.provider.ts`
(new), `remix-generation.provider.ts` (constraint validation + mode guard),
`remix.controller.ts` (bounds check), `remix.module.ts` /
`generation.module.ts` (wiring), `web/src/lib/api.ts`,
`web/src/components/remix/RemixStudioEditor.tsx`, tests and docs for issue
#1162 (first real remix generation provider, backlog D2).

**Findings:** none (no Critical/High/Medium/Low).

### Review Notes

- Credentials are reused from the existing catalog Lyria stack
  (`GOOGLE_AI_API_KEY` / `LYRIA_PROJECT_ID` ADC); no new secrets, and the
  remix provider holds no credential of its own.
- Double gate: `REMIX_GENERATION_PROVIDER_KIND` only selects the
  implementation; `REMIX_GENERATION_ENABLED !== "true"` still short-circuits
  every provider call (checked per request, tested), so kind selection
  alone can never enable paid generation.
- Client-submitted constraints are bounds-checked at the endpoint before
  any project or provider work (duration whitelist, bpm 40–220, key
  pattern, boolean check) — out-of-range values cannot reach a paid vendor
  call. Combined with #1144's per-user generation rate limit (enforced
  first), cost abuse surface is bounded.
- `stem_mix` is rejected (`invalid_input`) rather than silently generating
  unrelated audio from a text prompt — honest-output guarantee.
- Voice/likeness remains type-level `false` in the provenance contract; the
  provider never inspects or forwards a likeness flag.
- Generated audio is written through the existing storage provider under
  `remix-drafts/<projectId>/`; URIs are recorded in project metadata only
  readable by the owner-scoped project API.
- Vendor errors are normalized; raw provider error bodies are not returned
  to clients (only the normalized code/message/retryable contract).

### Commands Run

```bash
rg -n 'password|secret|api_key|private_key|\$queryRaw|executeRaw|eval\(' \
  backend/src/modules/remix/lyria-remix-generation.provider.ts \
  backend/src/modules/remix/remix-generation.provider.ts \
  backend/src/modules/remix/remix.controller.ts backend/src/modules/remix/remix.module.ts
git diff --check
cd backend && npm run test  # 778 passed
cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='remix.integration'  # 28 passed
cd backend && npm run lint  # tsc clean
cd web && npx vitest run    # 445 passed
cd web && npm run build     # pass
```

## Scan: feat/1165-studio-audio-preview (2026-06-11)

**Scope:** `backend/src/modules/remix/remix.controller.ts`,
`backend/src/modules/remix/remix-project.service.ts`,
`web/src/components/remix/RemixStudioEditor.tsx`,
`web/src/lib/remixAudioPreview.ts`, `web/src/lib/api.ts`, tests and docs for
issue #1165 (Remix Studio source-stem preview and generated draft playback).

**Findings:** none (no Critical/High/Medium/Low).

### Review Notes

- Draft audio is owner-scoped through JWT auth and project ownership checks;
  the endpoint streams bytes through the storage provider and returns 404 for
  missing or malformed generation metadata.
- Raw storage URIs are not returned to the browser, and the studio adds no
  download/export affordance. Export remains deferred to the licensed export
  policy surface.
- Source-stem preview uses the existing public preview endpoint and Web Audio
  gain nodes for mute/gain/solo playback. Persisted edit semantics are
  unchanged; solo remains preview-only state.
- No new secrets, environment variables, raw SQL, or dynamic HTML sinks were
  added.

### Commands Run

```bash
rg -n '(api[_-]?key|secret|private[_-]?key|BEGIN (RSA|OPENSSH|EC|PRIVATE)|password\s*=|token\s*=)' \
  backend/src/modules/remix backend/src/tests/remix.controller.http.spec.ts \
  backend/src/tests/remix.integration.spec.ts web/src/components/remix \
  web/src/lib/remixAudioPreview.ts docs/features docs/issue-1165-implementation-plan.md
rg --pcre2 -n 'https?://(?!localhost|github.com|book.getfoundry.sh|docs.runtimeverification.com|docs.certora.com|www.w3.org|storage.googleapis.com)' \
  backend/src/modules/remix web/src/components/remix web/src/lib/remixAudioPreview.ts \
  web/src/lib/api.ts docs/features/remix_studio.md docs/features/README.md \
  docs/issue-1165-implementation-plan.md
rg -n '\$queryRaw|\$executeRaw|innerHTML|dangerouslySetInnerHTML|eval\(' \
  backend/src/modules/remix web/src/components/remix web/src/lib/remixAudioPreview.ts
git diff --check
cd backend && npm run lint  # tsc clean after npx prisma generate
cd backend && npx jest --runInBand src/tests/remix.controller.http.spec.ts  # 24 passed
cd backend && npx jest --runInBand --config jest.integration.config.js --testPathPattern='remix.integration'  # 29 passed
cd web && npx vitest run src/components/remix/RemixStudioEditor.test.tsx  # 25 passed
cd web && npx eslint src/components/remix/RemixStudioEditor.tsx src/components/remix/RemixStudioEditor.test.tsx src/lib/remixAudioPreview.ts src/lib/api.ts
cd web && npm run build  # pass
```

## 2026-06-12 — #1184 Stem Audio Feature Extraction (slice 1 of #1182)

Scope: `workers/demucs/audio_features.py` (librosa extraction) +
`/analyze` endpoint, `stemFeatures` map on Pub/Sub results and the legacy
HTTP separation response, backend boundary sanitizer
(`backend/src/modules/ingestion/stem-audio-features.ts`), nullable
`Stem.audioFeatures` column, remix project read exposure.

### Findings

- Worker payloads are treated as untrusted at the backend boundary: the
  sanitizer whitelists fields, requires `schemaVersion`
  `stem-audio-features/v1` and an extractor name, clamps BPM to 30–300,
  bounds confidences to [0,1], and nulls non-finite numerics. Malformed
  payloads are dropped with a warning — never a 500, never persisted raw.
- `POST /analyze` deliberately matches `/separate`'s inbound auth posture
  (no in-app auth; deployment-level protection via Cloud Run IAM/private
  networking). It writes uploads only to a `TemporaryDirectory` and returns
  derived numbers, no echo of file contents; decode failures are 422.
- Feature extraction runs on worker-produced WAVs inside the separation
  flow; per-stem failure degrades to `features: null` and cannot fail or
  block stem persistence.
- The Prisma migration is additive (`ALTER TABLE "Stem" ADD COLUMN
  "audioFeatures" JSONB`); old payloads without `stemFeatures` skip the
  column entirely (undefined, not null-overwrite).
- No new secrets, env vars, raw SQL, dynamic HTML sinks, or external
  endpoints. librosa pinned (0.10.2.post1) in worker requirements.
- Review finding (fixed in-branch): both upload endpoints joined the
  client-controlled multipart filename to the scratch directory, so a
  filename like `../../x` escaped the TemporaryDirectory (write-anywhere as
  the container user). `/analyze` was introduced with the flaw copied from
  the pre-existing `/separate` pattern; both now use the basename only with
  an empty-basename fallback, and a regression test posts a traversal
  filename and asserts no file lands outside the temp dir.
- Review finding (fixed in-branch): uploads were uncapped while librosa and
  demucs load whole files into memory — an OOM lever even behind
  deployment-level auth. Both endpoints now stream uploads to disk with a
  `WORKER_MAX_UPLOAD_BYTES` ceiling (default 200 MiB, documented in
  docs/deployment/environment.md) and refuse oversized bodies with 413;
  regression test included.

### Commands Run

```bash
rg -n '(api[_-]?key|secret|private[_-]?key|password\s*=|token\s*=)' \
  workers/demucs/audio_features.py workers/demucs/test_audio_features.py \
  backend/src/modules/ingestion/stem-audio-features.ts
rg -n '\$queryRaw|\$executeRaw|innerHTML|eval\(' \
  backend/src/modules/ingestion/stem-audio-features.ts workers/demucs/audio_features.py
git diff --check
# Worker: 13 passed (test_main + test_audio_features, venv with librosa)
# Backend: 802 unit passed (7 new sanitizer), remix+flow1 integration 40 passed
# Web: 470 passed, lint 0 errors
# Docker: CPU Dockerfile build verification (librosa/numba) — see PR notes
```
