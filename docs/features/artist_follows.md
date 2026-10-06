---
title: "Artist follows"
status: in-progress
owner: "@akoita"
issues: [1968, 1970]
---

# Artist follows

A listener can follow an artist. The feature is deliberately minimal: its purpose
is to give [Scene Scout](scene_scout.md) city demand and the first-listener
reception summary a canonical, consent-governed follow signal. There is **no
feed, no notification and no public follower count** (small counts could identify
listeners), and no endpoint lists or counts an artist's followers.

## Behavior

- `GET /artists/:artistId/follow` returns `{ following: boolean }` for the JWT
  subject.
- `PUT /artists/:artistId/follow` follows (idempotent). The optional body is
  `{ releaseId?, trackId?, source?, geo? }`. Release and track context are kept
  only when they belong to that artist's own catalog; otherwise they are dropped
  silently. `geo` is the listener's user-declared city, handled like the `geo` on
  the browser telemetry routes.
- `DELETE /artists/:artistId/follow` unfollows (idempotent).
- An unknown artist is `404`; following a profile the caller owns or manages
  (`Artist.userId` or `managementOwnerUserId`) is `400`; closed or erased
  accounts get `403`. The write takes the same user row lock as erasure, so no
  follow is written for an account being erased.
- State lives in `ArtistFollow` (`userId`, `artistId`, unique pair). Erasure
  deletes the person's rows and the export includes only the person's own rows.

## Ledger events

A new follow emits `artist.followed`; an actual removal emits `artist.unfollowed`.
They are emitted server-side by the follow service (clients cannot emit them
through the product-event route), at the pseudonymous tier, only when the user
has a current analytics consent grant, with `consentBasis: "consent"`. Without
consent nothing is written to the ledger, but the follow itself still works.
See the [event ledger](analytics_event_ledger.md).

## Where follows are counted

- **Scene Scout city demand** counts `artist.followed` once per listener and
  release when the release (or the track's release) is in the artist's catalog,
  with the same consent, user-declared city, taste-reset, agent-training and
  owner exclusions as saves, and only while the listener still follows the
  artist. Follows are not a resonance event; the `DISCOVERY_MIN_AUDIENCE` and
  signal floors are unchanged.
- **First-listener reception** reports `follows`: heard listeners (after the
  placement and inside the release's first catalog week) who followed the artist
  afterwards and still follow, suppressed under the same floors as saves.

## Known limits

- The browser does not yet ask for or send a city, so follows from the current
  web app do not add to city demand (they do count in reception). Browser city
  entry remains tracked in [#1968](https://github.com/akoita/resonate/issues/1968).
- Follows made from the artist page carry no release, so they do not count toward
  release-level city demand.
- The artist analytics `listenerGrowth` block still reports growth over time as
  unavailable.

## Code and tests

`backend/src/modules/artist_follows/`, `web/src/components/artist/FollowArtistButton.tsx`.
Backend: `artist_follow.integration.spec.ts`, `artist_follow.controller.http.spec.ts`,
the Scene Scout and privacy manifest/integration specs. Web:
`FollowArtistButton.test.tsx` and `src/lib/help/help.test.ts`.
