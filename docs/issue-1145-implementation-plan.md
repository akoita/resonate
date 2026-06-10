---
title: "Implementation Plan: Stem Detail Page Redesign And Remix Access"
status: draft
owner: "@akoita"
issues:
  - "https://github.com/akoita/resonate/issues/1145"
related:
  - docs/features/remix_studio.md
  - docs/features/marketplace_listing_lifecycle.md
  - docs/issue-1141-implementation-plan.md
---

# Implementation Plan: #1145 Stem Detail Page

Branch: `feat/1145-stem-page-redesign`

Four coordinated fixes that together make the stem page the polished asset
destination for remix access: the config bug that silently kills it, the
missing navigation into it, the bare UI, and the release-CTA all-stems gate.

## Slice 1 — Kill the config drift (restores the Remix card by itself)

Replace `process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:300x"` with
the canonical `API_BASE` in all four call sites:

- `web/src/app/stem/[tokenId]/page.tsx` (the remix-entry killer)
- `web/src/components/content-protection/ContentProtectionBadge.tsx`
- `web/src/hooks/useSynthIdVerification.ts` (fallback was 3001 — wrong port)
- `web/src/hooks/useLyriaRealtime.ts` (same)

No new env vars; one undocumented var removed from circulation.

## Slice 2 — Navigation entry points

- Marketplace `ListingCard`/card grid: artwork + title become a link to
  `/stem/:tokenId` (the existing play-overlay and Buy actions keep their own
  click handlers; card body navigation must not hijack them).
- Release page owner NFT chips: minted stems link to their token page.
- The stem page keeps "← Back to Marketplace".

## Slice 3 — Redesign `/stem/[tokenId]` as the asset page

Design language: the app's existing dark glass aesthetic — `glass-panel`
cards, `stem-type-badge--*` colors, purple remix accent, emerald commerce
accent — taken further rather than replaced. The page identity derives from
the stem type: a `stemTypeTheme(type)` helper maps each type to its existing
badge color, used as the hero's accent (artwork ring, ambient glow, section
markers). Original without being foreign.

**Hero (full-bleed):**

- Ambient backdrop: the artwork blurred and dimmed behind a gradient so each
  stem page carries its release's color world.
- Artwork card with a type-colored ring and the marketplace's play-overlay
  pattern wired to the existing preview endpoint
  (`/catalog/stems/:stemId/preview`) through a lightweight inline audio
  element — listen before you buy/remix.
- Badge row reusing marketplace badges: AI provenance, stem type, SynthID
  when known, `Remixable`, NFT.
- Identity: stem display name as the title (no more "Stem #79"),
  attribution line "from <track> · <artist>" linking to the release page,
  creator chip with explorer link, listing countdown chip when active.

**Action rail (the page's purpose, one row under the hero):**

- `Buy` — opens the existing BuyModal with tier listings/pricing (fetched via
  the public listings payload filtered by stem); shows `Your Listing` state
  for the seller instead.
- `Remix in Studio` — the existing `RemixCta` button variant (eligibility
  drives enabled / license-required / blocked states).
- `List for Sale` — owners with balance (existing modal, now tier-aware from
  #1141).
- Copy-link.

**Info grid (glass panels, two columns desktop / stacked mobile):**

- On-chain metadata: token, creator, royalty + receiver, explorer links,
  metadata URI.
- License tiers: which tiers are currently listed with prices (from
  `tierListings` + stem pricing) — makes "what rights can I buy here"
  explicit.
- Remix lineage (existing component, restyled container).
- Content protection (existing badge, restyled container).

**States:** loading skeleton (kept), not-found (kept), metadata-fetch-failed
fallback that still renders on-chain data with a quiet "catalog details
unavailable" note — the page must never silently lose its actions again.

Pure helpers for render-free tests: `stemTypeTheme`, `formatListingCountdown`.

## Slice 4 — Partial remix eligibility (release CTA)

`evaluateRemixEligibility` v2 (`REMIX_POLICY_VERSION` bump):

- Source checks unchanged (any source-level denial still blocks everything).
- Stem licensing: **allowed when ≥1 requested stem is licensed**;
  `license_required` only when zero are. Non-remixable-mint stems still hard-
  deny if *selected explicitly*; for track-default requests they are excluded
  from the licensed subset instead of blocking the track.
- Decision keeps the per-stem `licensed`/`remixable` array (the CTA already
  creates drafts from the licensed subset — no frontend change needed beyond
  none).
- Tests: policy unit cases (one-of-many licensed → allowed; zero licensed →
  license_required; explicit non-remixable selection still denies; track
  default skips non-remixable), integration case (buy one stem's remix
  license → track-scoped eligibility allowed → draft contains only that
  stem), feature-doc update.

## Tests

- `stemTypeTheme`/`formatListingCountdown` unit tests.
- Stem page render tests: loaded hero (name, attribution, badges, actions),
  metadata-fallback state, not-found.
- Marketplace card: link presence to `/stem/:tokenId` without breaking
  play/buy handlers.
- Backend: updated policy spec + integration partial-allowance case.

## Docs

- `docs/features/remix_studio.md`: partial eligibility semantics; stem page
  as the remix access surface.
- `docs/features/marketplace_listing_lifecycle.md` + catalog row: stem detail
  navigation.
- `docs/deployment/environment.md`: note that `NEXT_PUBLIC_BACKEND_URL` is
  not a Resonate variable (removed from code).

## Commit plan

1. `fix(#1145): use canonical API_BASE in all browser metadata fetches`
2. `feat(#1145): link marketplace and release surfaces to stem detail pages`
3. `feat(#1145): redesign stem detail page as themed asset hero with actions`
4. `feat(#1145): allow partial remix eligibility for track-scoped requests`
5. `docs(#1145): update remix and marketplace docs for stem page access`

## Verification

- Web: full vitest, eslint on changed files, `npm run build`.
- Backend: lint, policy unit suite, remix integration suite.
- Security scan greps + `git diff --check` + audit report entry.
- Manual staging after merge: marketplace card → stem page (artwork, title,
  preview, Remix button as buyer), release page chip enabled with one
  licensed stem.
