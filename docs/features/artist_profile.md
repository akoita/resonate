---
title: "Artist Profile (editable) + reliable artist links"
status: implemented
audiences: [artists, listeners, frontend/backend developers]
issues: ["https://github.com/akoita/resonate/issues/1419", "https://github.com/akoita/resonate/issues/1762", "https://github.com/akoita/resonate/issues/1856", "https://github.com/akoita/resonate/issues/1763"]
---

# Artist Profile (editable) + reliable artist links

Two artist-experience improvements (#1419, `vision:keep` — no fee/split/payout
impact):

1. The owning artist can **edit their profile** — image, bio, website, and
   social links.
2. A resolved release credit links to its `/artist/[id]` page; an ambiguous
   credit stays on the name-based catalog route.

The #1856 claim-entry and audit changes are vision-neutral identity and UX
quality under ADR-BM-6. They do not change money, rights, or payouts.

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

### Artist (optional AI suggestions)

In **Edit profile**, choose **Find suggestions** to search public MusicBrainz
artist identities. A three-step indicator (choose artist, review fields, save
profile) shows progress. Pick the exact artist after checking the
disambiguation, location, match score, and source page, then choose **Review
suggestions**. A shared name alone never chooses an identity; **None of these
match** leaves the profile untouched. A second request retrieves source-linked
suggestions for the selected identity. Each field shows its confidence and
source, the bio is labelled **AI draft**, and image suggestions show a preview.
You may edit and select individual fields. When a field already has a value,
its current value is shown and replacing it requires a separate explicit
choice. **Add N fields to form** only stages values locally and marks them
**Suggested** in the editor; **Save changes** is still required to publish
them. If a suggestion is edited after staging, it must be added to the form
again before that edit is saved. Closing the panel or canceling the editor changes nothing.

MusicBrainz identity and official-link relationships are the source for
candidates, website, and social links. The short bio is AI-written only from
bounded, structured public facts associated with the chosen identity; the
model cannot choose a different identity or write profile data. If model
generation fails or is unavailable, the bio is omitted while usable link
suggestions remain available. An image is suggested only when its Wikimedia
Commons metadata identifies it as public domain or CC0; review the linked
file details before use. Source links, confidence, and image rights appear in
the review step. The editor stores only the fields you explicitly save, not
the candidate search, model output, or rejected suggestions. External-source
errors and rate limits leave the existing profile unchanged.

The trust boundaries and request flow are documented in
[artist profile enrichment architecture](../architecture/artist_profile_enrichment.md).

If an accepted transfer was a mistake, the former manager can open Artist
management and submit evidence for operator review. The request does not
restore access. An operator can approve recovery only while the recipient
still manages the exact transferred resources and no later accepted transfer
has involved them. The decision remains in the management audit history;
rights, credits, and payouts are unchanged.

### Artist or representative (request public profile access)

Sign in and open `/artist/management`. Search for a credited artist, select the
exact profile, and compare its public catalog with the artist you represent.
Same-name results remain separate profiles. Submit 20–4,000 characters of
evidence for an operator to review. The request is private, and the workspace
shows your latest pending, approved, rejected, or revoked status for each
profile. Rejected or revoked requesters can submit new evidence while the exact
profile remains eligible; a profile already claimed by someone else no longer
offers a retry. Profiles without a confirmed main credit likewise do not offer
an evidence form. Public artist pages have no claim prompt or claimability badge.

Only an approved request permits editing that public profile. The server checks
the exact artist ID and non-ambiguous release credit at submission and review;
it does not derive authority from name matching, release uploads, or client
state. Approval never transfers release management, rights, payouts, or private
analytics. Claim submission is rate-limited per account. Operators retain the
evidence and decision route; listeners and other requesters cannot read them.
Every approval, rejection, and revocation appends an internal decision event.
Account erasure removes private free-text evidence and notes from retained
review history.

### Operator (review a public profile claim)

Open **Artist Claims** in the admin navigation (`/admin/artist-claims`) to see
pending public-profile requests. Inspect the exact artist page and catalog,
the requester's identity, and their private evidence before entering a review
note and approving or rejecting. The queue is separate from **Transfer
Recovery**, which lists accepted management-transfer recovery requests. A
request remains pending until an operator other than its requester reviews it;
administrators and operators cannot decide their own claims. Approval grants
only public-profile editing access.

### Developer / API

- `PATCH /artists/:id` (JWT, manager owner or approved public-profile claimant) — body
  `{ imageUrl?, summary?, socialLinks?: { x?, instagram?, tiktok?, youtube?, soundcloud? }, website? }`.
  A field absent = leave unchanged; `null`/empty = clear. URLs are validated
  server-side to **http(s) only** (rejects `javascript:`/`data:`/other schemes)
  and length-capped; the bio is capped at 2000 chars. Returns the updated
  profile. `PATCH /artists/:id/settings` (remixConsent) is unchanged.
- `GET /artists/:id/enrichment/candidates` and
  `POST /artists/:id/enrichment/suggestions` (JWT, `PROFILE_EDIT` scope) return
  distinct public identities and then source-linked suggestions for one
  selected identity. Both are throttled and read only. Their responses are
  review material, not authority to edit; the existing `PATCH` remains the
  sole write path.
- `GET /artists/:id` returns public profile fields including `website` and
  `socialLinks`, without account ownership, payout data, claimability status,
  or private claim proof.
- `GET /artists/claims/me` (JWT) returns only the caller's latest status per
  exact artist, with the artist name, image, and current request eligibility.
  Authenticated `GET /artists/search` includes that eligibility for exact-profile
  selection. `POST /artists/:id/claims`
  (JWT) accepts bounded evidence for an eligible, credited public artist;
  operator-only claim review records the decision. These endpoints never grant
  release-level management by implication.
- `GET /artists/claims/pending` and `PATCH /artists/claims/:claimId` require an
  admin or operator JWT. The reviewer must be a different account from the
  claimant, including when the claimant also has an operator role.
- `GET /management/artists/:id/access` (JWT) reports the caller's profile
  scope; the current management owner alone sees invitation history. Grant and
  transfer endpoints require the current owner and recipient to act separately.
- `POST /management/transfers/:id/recovery-requests` accepts the original
  proposer's evidence for an accepted transfer. `GET /management/recoveries/me`
  shows that account's transfer and recovery status without private review
  evidence. Admin/operator-only reads and decisions under
  `/management/recoveries` recheck the transfer snapshot and current management
  owners before changing authority.

## Data model

`Artist.imageUrl`, `summary`, `socialLinks` (JSON) already existed;
`website String?` added by migration `20260710000000_artist_profile_website`.
`ArtistClaimDecisionEvent` records the sequence of operator decisions for a
claim while `ArtistClaimRequest` carries its current state. The event is
internal audit history, not a public API response.

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
  `artist-enrichment.service.ts` (public-source suggestions),
  `backend/src/tests/artist-profile.integration.spec.ts`.
- Frontend: `web/src/components/artist/ArtistProfileEditor.tsx`,
  `ArtistEnrichmentPanel.tsx`,
  `ArtistSocialLinksRow.tsx`, `ArtistClaimCenter.tsx`,
  `ArtistClaimRequestPanel.tsx`, `web/src/app/admin/artist-claims/page.tsx`,
  `web/src/lib/artistProfileForm.ts`,
  `web/src/lib/artistRoutes.ts` (`trackArtistCreditHref`),
  `web/src/app/artist/[id]/page.tsx`. Tests: `web/src/lib/artistProfileForm.test.ts`,
  `artistRoutes.test.ts`, `web/src/components/artist/ArtistProfileEditor.test.tsx`.
- User Guide: the `artist-profile` article (`web/src/lib/help/content.ts`).
