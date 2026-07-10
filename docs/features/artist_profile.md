---
title: "Artist Profile (editable) + reliable artist links"
status: implemented
audiences: [artists, listeners, frontend/backend developers]
issues: ["https://github.com/akoita/resonate/issues/1419"]
---

# Artist Profile (editable) + reliable artist links

Two artist-experience improvements (#1419, `vision:keep` — no fee/split/payout
impact):

1. The owning artist can **edit their profile** — image, bio, website, and
   social links.
2. An artist's name **reliably links to their `/artist/[id]` page** wherever a
   backing profile id exists.

## Status

`implemented`.

## Who it is for

Artists (edit their own page); listeners (discover an artist from any surface
that shows their name).

## Value

The artist page is the public face of an artist on Resonate. Before this, it was
read-only after onboarding, and many artist names were shown as non-clickable
text even when a profile existed. Now artists control how they present
themselves, and fans can reach the profile in one click.

## How to use

### Artist (edit)

Open your artist page (`/artist/[id]`) while signed in as its owner → **Edit
profile** → set profile image, bio, website, and social links (X, Instagram,
TikTok, YouTube, SoundCloud) → save. The edit affordance is owner-only; the page
is read-only for everyone else.

### Developer / API

- `PATCH /artists/:id` (JWT, owner-scoped via `requireOwnedArtist`) — body
  `{ imageUrl?, summary?, socialLinks?: { x?, instagram?, tiktok?, youtube?, soundcloud? }, website? }`.
  A field absent = leave unchanged; `null`/empty = clear. URLs are validated
  server-side to **http(s) only** (rejects `javascript:`/`data:`/other schemes)
  and length-capped; the bio is capped at 2000 chars. Returns the updated
  profile. `PATCH /artists/:id/settings` (remixConsent) is unchanged.
- `GET /artists/:id` returns the profile including `website` and `socialLinks`.

## Data model

`Artist.imageUrl`, `summary`, `socialLinks` (JSON) already existed;
`website String?` added by migration `20260710000000_artist_profile_website`.

## Link behavior

- **`releaseArtistProfileHref`** (id-based) is used wherever a release carries a
  profile id — release page main artist, per-track credits (via
  `trackArtistCreditHref`, which also links **featured** artists from
  `artistCredits[]`), the home `ReleaseHero`, and catalog/marketplace listings.
  Rendered as real `<Link>`/anchors (keyboard-focusable, open-in-new-tab).
- The old name-match heuristic (`releaseArtistCreditHref`) is retained only for
  free-text credits with no reliable id backing, to avoid mis-linking.

## Deferred / not yet linked

Surfaces that display only a **free-text** artist name with no profile id — the
player now-playing bar, the `/player` queue, and library artist rows — still do
**not** link to `/artist/[id]`. Making them link requires threading an artist id
through the player/library track models; deferred as disproportionate for this
polish slice (tracked in #1419's follow-up notes).

## Code references

- Backend: `backend/src/modules/artist/artist.controller.ts` (`PATCH /artists/:id`),
  `artist.service.ts` (`updateProfile` + URL normalization),
  `backend/src/tests/artist-profile.integration.spec.ts`.
- Frontend: `web/src/components/artist/ArtistProfileEditor.tsx`,
  `ArtistSocialLinksRow.tsx`, `web/src/lib/artistProfileForm.ts`,
  `web/src/lib/artistRoutes.ts` (`trackArtistCreditHref`),
  `web/src/app/artist/[id]/page.tsx`. Tests: `web/src/lib/artistProfileForm.test.ts`,
  `artistRoutes.test.ts`, `web/src/components/artist/ArtistProfileEditor.test.tsx`.
- User Guide: the `artist-profile` article (`web/src/lib/help/content.ts`).
