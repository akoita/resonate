---
title: "Release Artist Identity Refactor"
status: in-progress
owner: "@akoita"
---

# Release Artist Identity Refactor

## Problem

The current catalog model overloads `Artist` and `Release.artistId`.
Depending on the feature, the same field can mean:

- the connected user profile that uploaded or manages a release;
- the public artist credited on the release;
- the artist whose metrics appear in analytics and warehouse reports;
- the authority/payout identity for rights, Shows, marketplace, or trust flows.

That ambiguity makes a manager profile such as `green` or `bouba` appear as the
public artist for releases whose declared artist is someone else. Grouping by
`primaryArtist` hides the symptom in some UI surfaces, but it is not a durable
actor model because a free-text string is not the artist identity.

## Target Model

Separate four concepts:

| Concept | Purpose | Examples |
| --- | --- | --- |
| User account | Authenticates a wallet/session and owns private app state. | listener, artist, manager, operator |
| Listener profile | Public/private fan identity and community visibility. | display name, taste badges, backed campaigns |
| Artist manager / release manager | Operational actor that uploads and administers releases. | artist team, label, distributor, self-managed artist |
| Public artist profile | Public creative identity credited on releases and campaigns. | SennaRin, Makoma, Nickelback |

The first compatible database slice keeps existing manager ownership in
`Release.artistId`, then introduces `ReleaseArtistCredit` rows for public
release identity:

```text
Release.artistId              = manager/uploader artist profile for ownership
ReleaseArtistCredit.artistId  = public artist/contributor profile credited on the release
ReleaseArtistCredit.role      = main, featured, producer, composer, remixer, etc.
ReleaseArtistCredit.sortOrder = display/billing order within that role
```

Existing `primaryArtist` and `featuredArtists` strings remain as compatibility
snapshots during migration. New code should prefer `ReleaseArtistCredit`.

## Music Credit Semantics

Credits should not collapse music-business reality into one owner field:

- a release can have several main artists at equal billing, such as a
  collaboration between two artists;
- a release can have featured artists with different billing prominence;
- tracks can eventually override or extend release-level credits;
- producer, composer, remixer, lyricist, label, publisher, and rights-holder
  credits are optional and may matter for metadata, discovery, payouts, and
  rights evidence;
- creative credit and economic/control authority are related but not identical.

For this first slice, `ReleaseArtistCredit.role` is intentionally a string so
the system can ingest real-world role terms without needing a schema migration
for every contributor type. Product UI should initially present a curated set:

| Role | Meaning |
| --- | --- |
| `main` | Main billed artist. Multiple rows are allowed for collaborations. |
| `featured` | Featured performer/artist. |
| `producer` | Production credit. |
| `composer` | Composition/songwriting credit. |
| `remixer` | Remixing artist/producer. |

Public artist pages, Shows, and listener-facing discovery should use `main`
artist credits first, then `featured` when relevant. Rights and payout systems
must not infer ownership only from a visible credit.

## Impact Map

### Catalog Backend

- `CatalogService.createRelease` must create public artist profiles for selected
  release credits when needed, then create `ReleaseArtistCredit` rows.
- `listPublished`, `getRelease`, `search`, `getTrack`, and owner-scoped reads
  should return release credits.
- `listByArtist(:artistId)` should become a public credited-artist discography
  read using `ReleaseArtistCredit`, not manager ownership.
- Managed catalog reads should continue using `Release.artistId` and artist
  `userId` ownership.

### Upload UI

- The release form should stop defaulting public artist identity to the manager
  profile as an implicit fact.
- Upload should offer selected artist credits: existing public artist profile
  or create a new unclaimed public artist profile.
- First slice can keep text entry, but backend must materialize it into public
  artist profiles/credits. Later UI should provide a picker/create dialog with
  image, summary, links, socials, claim status, and authority notes.

### Public Catalog UI

- Home catalog artist summaries, artist detail pages, release pages, player,
  library imports, and Shows selectors should prefer `artistCredits`.
- `primaryArtist` is a fallback only for legacy records or stale API clients.
- Manager/uploader profile should only appear in managed catalog/admin contexts.

### Shows

- Campaign subjects should reference public artist profiles/credits, not
  uploader managers.
- Artist-owned campaign authority still needs claim/manager authorization:
  a self-managed artist can act directly; an artist manager needs granted
  authority or operator review.
- Until explicit artist claims and manager grants exist, operator-reviewed
  campaigns can target public artist profiles with evidence.

### Rights, Trust, And Marketplace

- Rights routing currently uses uploader trust (`Release.artistId`) and
  declared `primaryArtist` mismatch checks. That should become explicit:
  uploader/manager trust is one signal, credited public artist authority is
  another.
- Trusted-source links and creator trust currently attach to `Artist`; after
  public profiles exist, the trust model must distinguish manager trust from
  artist authority.
- Marketplace listings and x402 receipts should expose public credited artist
  identity to buyers, while settlement/authorization remains manager or
  authority scoped.

### Analytics And Data Warehouse

This is the highest-risk surface. Today `artistId` in product events, clean
rows, facts, views, BigQuery report queries, and Dataflow marts means one
dimension. In practice it mixes:

- manager/uploader artist id for upload, rights, payout, and owner analytics;
- public credited artist id/name for listener-facing plays and discovery;
- Shows campaign artist id for demand and pledge events.

The migration should add explicit dimensions before changing semantics:

| Field | Meaning |
| --- | --- |
| `managerArtistId` | Uploader/manager profile that administers the release. |
| `creditedArtistId` | Primary public artist profile credited for the track/release. |
| `creditedArtistName` | Snapshot of public artist display name. |
| `artistId` | Compatibility alias during migration; should eventually be replaced or documented by event family. |

Backend enrichment should populate these fields from catalog metadata:

- playback lifecycle events;
- library/playlist actions;
- agent selections;
- purchases/payments/x402;
- rights route decisions;
- stem upload/processing events;
- Shows campaign events.

Warehouse/Dataflow impact:

- `events_clean` should extract `managerArtistId`, `creditedArtistId`, and
  `creditedArtistName` from payload.
- `analytics_facts` should preserve all three dimensions.
- `daily_event_artist_track` should either remain compatibility `artistId` or
  split into manager and credited artist views.
- `artist_catalog_daily_metrics` should define whether it is manager-owned
  operational analytics or credited public artist analytics.
- BigQuery artist dashboard queries must choose a dimension. The safer default
  is manager/owner analytics for authenticated artist dashboards until artist
  claims and manager grants are implemented.
- Future public artist analytics can query by `creditedArtistId`.

### Recommendations And Agent Taste

- Taste models are track-centric today and mostly safe.
- Any artist diversity, novelty, or explanation text should use credited public
  artist identity.
- Manager/uploader ids should not affect listener taste unless the listener is
  intentionally interacting with the manager/label identity.

### MCP, Storefront, And External APIs

- Machine clients need stable public artist identities, not free-text credits.
- API responses should include both manager and credited artist fields during
  migration so external clients can upgrade without ambiguity.
- x402/commerce receipts should include public credited artist display data and
  settlement/owner authority separately.

## Rollout Slices

1. **Schema and backend compatibility**
   - Make `Artist.userId` nullable for unclaimed public artist profiles.
   - Add public profile fields and `ReleaseArtistCredit`.
   - Backfill credits from existing `primaryArtist`/`featuredArtists`.
   - Create credits on new releases.

2. **Catalog reads and frontend display**
   - Return `artistCredits` from public catalog APIs.
   - Update Home, release pages, player, catalog artist pages, and Shows
     selectors to use credits.

3. **Upload artist picker/create flow**
   - Let managers select or create public artist profiles during upload.
   - Keep manager profile separate from release credits in copy and payloads.

4. **Authority and claims**
   - Add artist profile claim flow and manager grants.
   - Gate public profile edits, payout changes, Shows activation, and
     analytics access by claim/grant status.

5. **Analytics and warehouse dimension split**
   - Add `managerArtistId`, `creditedArtistId`, and `creditedArtistName` to
     product events, warehouse transforms, BigQuery queries, and docs.
   - For multi-main-artist releases, event payloads should carry a primary
     display credit plus arrays of credited artist ids/names so marts can
     choose lead-artist, split-credit, or all-credited rollups explicitly.
   - Keep compatibility fields until dashboards and agents are migrated.

## First-Slice Constraints

- Do not rename `Release.artistId` yet; too many modules use it for ownership,
  payout, rights, and analytics.
- Do not change dashboard authorization yet; authenticated artist dashboards
  remain manager-owned until claim/grant semantics exist.
- Do not remove `primaryArtist`/`featuredArtists`; they remain compatibility
  snapshots and import/export affordances.
