# Issue #1419 — Reliable artist links + editable artist profile

**Sprint:** Vision Sprint 5 (final item). **Label:** `vision:keep` (conformant polish — no fee/split/payout impact). Priority: nice-to-have end-of-sprint polish (per @akoita).

## Goal
Two artist-page improvements: (1) make artist names reliably link to `/artist/[id]` wherever a profile id exists, as real links; (2) let the owning artist edit their profile (image, bio, social links, website).

## Key findings (recon)
- **`Artist` model** (`backend/prisma/schema.prisma:430-457`): `imageUrl`, `summary` (bio), `socialLinks Json?` (defined, **unused**) already exist. **Only `website` is missing** → one small migration.
- **Owner-scoped update exists but is narrow:** `PATCH /artists/:id/settings` → `updateSettings` (handles only `remixConsent`); ownership via `requireOwnedArtist(userId, artistId)` (`artist.service.ts:167-176`). The module has **no DTO/class-validator**. Onboarding `POST /artists` is create-only (throws if exists) — not reusable for edits.
- **`GET /artists/:id`** (`findById`) returns all scalar columns → `website` will be included automatically post-migration.
- **Link audit:** Tier-1 surfaces (release main artist `release/[id]/page.tsx:1360`, per-track credits `:2068`, `ReleaseHero.tsx:41`) all have profile ids but are gated by `releaseArtistCreditHref`'s name-match heuristic (returns null when free-text `primaryArtist` ≠ profile `displayName`) and rendered as `<span onClick>`. Tier-2 (home/catalog/marketplace) already link correctly. Tier-3/4 (PlayerBar, library, /player) carry only free-text names, no profile id.

## Scope decision (maestro)
- **IN:** the editable profile (full: field + endpoint + DTO + edit UI + render), and fixing/verifying every artist-name surface that **already has a profile id** (Tier 1 fix + Tier 2 verify). This is the high-value, proportionate scope.
- **OUT (deferred, tracked):** Tier-3/4 free-text surfaces (player now-playing, /player queue, library rows). Making these link to `/artist/[id]` requires threading an artist id through the player/library track models — disproportionate for a `vision:keep` polish item. Documented as a follow-up note in the PR + feature doc, not silently dropped.
- **`website`:** add a dedicated `website String?` column (first-class, validatable) rather than folding into `socialLinks`.
- **`socialLinks` shape (canonical, both workers agree):** `{ x?: string; instagram?: string; tiktok?: string; youtube?: string; soundcloud?: string }` — each a full URL, https-normalized; empty/absent keys omitted.

## Work items

### WI-1 — Backend: `website` field + owner-scoped profile update  *(Sonnet)*
Files: `backend/prisma/schema.prisma` (+ migration), `backend/src/modules/artist/artist.controller.ts`, `artist.service.ts`, `backend/src/tests/*`.
1. Migration: add `website String?` to `Artist`. Run `npx prisma generate` + create a migration.
2. DTO: an `UpdateArtistProfileDto` (or validated inline body) — `imageUrl?`, `summary?`, `socialLinks?` (the shape above), `website?`. Validate/normalize URLs (https, reject javascript:/data:); trim bio; cap lengths (bio e.g. ≤2000, url ≤2048). The module has no class-validator today — either add `class-validator` decorators (check it's a dep) or hand-roll normalization consistent with the existing `normalizeRemixConsent` style. Prefer explicit normalization helpers.
3. Service: `updateProfile(userId, artistId, input)` reusing `requireOwnedArtist`; writes imageUrl/summary/socialLinks/website; returns the updated public profile shape (same as `findById`). Do NOT touch remixConsent here (that stays on the settings path).
4. Controller: `PATCH /artists/:id` (JWT, owner-scoped) → `updateProfile`. Keep `PATCH /artists/:id/settings` unchanged.
5. Tests (`artist-profile.integration.spec.ts`, Testcontainer Postgres, real prisma, unique TEST_PREFIX): owner updates all fields; non-owner → 403; URL validation rejects bad schemes; socialLinks partial shape persists; `GET /artists/:id` returns the new fields.

### WI-2 — Frontend: editable profile UI + link audit  *(Sonnet; codes against WI-1 contract below)*
Contract from WI-1: `PATCH /artists/:id` body `{ imageUrl?, summary?, socialLinks?: {x?,instagram?,tiktok?,youtube?,soundcloud?}, website? }` → returns the updated `ArtistProfile`.
Files: `web/src/lib/api.ts`, `web/src/app/artist/[id]/page.tsx`, `web/src/lib/artistRoutes.ts`, `web/src/app/release/[id]/page.tsx`, `web/src/components/home/ReleaseHero.tsx`, tests.

**Editable profile:**
1. `api.ts`: add `website?: string` + typed `socialLinks` to `ArtistProfile`; add `updateArtistProfile(token, id, body)` → `PATCH /artists/:id`.
2. `/artist/[id]/page.tsx`: add **owner detection** (fetch `getArtistMe`, compare `me?.id === artist.id`); render social links + website (read view, real anchors, `rel="noreferrer noopener"`); add an owner-only **"Edit profile"** affordance opening a form (image URL, bio, socials, website) that calls `updateArtistProfile` and refreshes. Reuse `Input`/`Button`/`useToast`/`ConfirmDialog` primitives; keep it accessible. Extract any pure helper (e.g. `normalizeSocialUrl`) so it can be unit-tested.

**Link audit (Tier 1 + verify Tier 2):**
3. `artistRoutes.ts`: make the audit surfaces prefer **`releaseArtistProfileHref`** (id-based) when a profile id exists, rather than gating on the name-match heuristic. Keep `releaseArtistCreditHref`'s guard only where a free-text credit could mis-link. Consider adding a small helper documenting the "id present → always link" rule.
4. Fix Tier-1 surfaces to real `<Link>`/anchors linking to `/artist/[id]`: release main artist (`release/[id]/page.tsx:1360`), per-track credits (`:2068`, use `artistCredits[].artistId` so featured credits link too), `ReleaseHero.tsx:41`. Keyboard-focusable, middle-click/open-in-new-tab works.
5. Verify Tier-2 (home/catalog/marketplace) still link correctly — no change expected.
6. Tests (`.test.tsx`): link helper links when an id is present regardless of name match; owner-only edit affordance shows for owner and hides otherwise; social/website render.

### WI-3 — Docs (maestro)
- Feature catalog + a short artist-profile note; user-guide article ("Edit your artist profile"); record the Tier-3/4 link deferral (player/library free-text) as a tracked follow-up.

## Verification (maestro runs each)
- backend: `npm run lint`; `npx prisma generate`; integration `artist-profile`.
- web: `vitest` for the new tests; eslint on changed files; no new tsc errors.

## Business-model / change-impact
- `vision:keep` — no fee/split/payout/analytics-schema impact. Permissions: owner-scoped write (reuses `requireOwnedArtist`). New API `PATCH /artists/:id` (additive). URL validation is the main security surface (reject non-http(s) schemes). Feature docs + user guide updated in-branch.
