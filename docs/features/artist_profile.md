---
title: "Artist Profile (editable) + reliable artist links"
status: implemented
audiences: [artists, listeners, frontend/backend developers]
issues: ["https://github.com/akoita/resonate/issues/1419", "https://github.com/akoita/resonate/issues/1762"]
---

# Artist Profile (editable) + reliable artist links

Two artist-experience improvements (#1419, `vision:keep` — no fee/split/payout
impact):

1. The owning artist can **edit their profile** — image, bio, website, and
   social links.
2. A resolved release credit links to its `/artist/[id]` page; an ambiguous
   credit stays on the name-based catalog route.

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

Open your artist page (`/artist/[id]`) while signed in with profile access →
**Edit profile** → set image, bio, website, and social links → save. A manager
edits their own profile; an approved claimant can edit an unclaimed public
artist page after operator review. Other visitors see the page read-only.

The profile management owner can invite another registered account to edit
public profile details from `/artist/management`. The recipient must accept.
Revocation or expiry removes that access. A separate accepted transfer changes
who owns profile management; the original `Artist.userId` remains as a legacy
account association and does not regain edit access. A verified claim still
grants profile editing only, not delegation, release control, rights, or payout
authority.

### Developer / API

- `PATCH /artists/:id` (JWT, manager owner or approved public-profile claimant) — body
  `{ imageUrl?, summary?, socialLinks?: { x?, instagram?, tiktok?, youtube?, soundcloud? }, website? }`.
  A field absent = leave unchanged; `null`/empty = clear. URLs are validated
  server-side to **http(s) only** (rejects `javascript:`/`data:`/other schemes)
  and length-capped; the bio is capped at 2000 chars. Returns the updated
  profile. `PATCH /artists/:id/settings` (remixConsent) is unchanged.
- `GET /artists/:id` returns public profile fields including `website` and
  `socialLinks`, without account ownership, payout data, or private claim proof.
- `GET /management/artists/:id/access` (JWT) reports the caller's profile
  scope; the current management owner alone sees invitation history. Grant and
  transfer endpoints require the current owner and recipient to act separately.

## Data model

`Artist.imageUrl`, `summary`, `socialLinks` (JSON) already existed;
`website String?` added by migration `20260710000000_artist_profile_website`.

## Link behavior

- `artistCreditHref` uses the credited profile ID only when the matching credit
  is resolved. Same-name or otherwise ambiguous credits open the catalog page
  for their displayed name. Manager/uploader IDs remain for managed views.

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
