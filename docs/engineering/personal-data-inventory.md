---
title: "Personal data inventory"
status: draft
owner: "@akoita"
issue: 1771
---

# Personal data inventory

Where a person's data lives, so export can be complete and erasure can be
honest. Written for #1771; **this document is the reviewable artifact, not the
code** — the issue requires the inventory be written down and checked rather
than implied by whatever a query happens to join.

Re-derive it whenever the schema changes. A model added without appearing here
is a model an erasure will silently miss.

## Corrections from building the export (#1771 slice 2)

Implementing the export against this document found three errors in it. They
are recorded rather than quietly fixed, because the reason each was missed
matters more than the corrected number.

**This document is no longer the only guard.**
`backend/src/modules/privacy/personal_data_export_manifest.ts` is now the
enforced version of it: every Prisma model must appear there as exported or
not-exported-with-a-reason, and `personal_data_export_manifest.spec.ts` drives
itself from the generated Prisma DMMF, so a model added to the schema fails the
build until someone classifies it. The prose here explains; the manifest is what
cannot drift.

**1. The original arithmetic did not reconcile.** The historical categories
below were an incomplete snapshot. Current model coverage is derived from the
generated Prisma datamodel and enforced by the export and erasure manifest
tests; this document does not maintain a competing model count.

**2. There was a blind spot shaped like its own thesis.** This document names
five identifiers and then enumerates models reachable by `userId`, wallet
address and `actorId` — but never enumerates the ones keyed by `artistId`,
despite listing it as one of the five. Thirteen models were missing as a result,
`Release` among them. The document warning that a person is not one identifier
was itself written from fewer than five.

Added by the manifest: `Release`, `ReleaseArtistCredit`, `CreatorTrust`,
`CommunityBenefitRule`, `CommunityRoom`, `CommunityDiscordBridge`,
`TrustedSourceArtistLink`, `PunchlineDrop`, `ArtistEngagement`, `DemandSignal` (all
`artistId`); `License` and `Payment` (`sessionId`); `Dispute`,
`DisputeEvidence` and `DisputeJurorAssignment` (wallet addresses —
`reporterAddr`, `creatorAddr`, `submitter`, `jurorAddr`); and
`AnalyticsConsent`, which #1772 added after this was written.

**3. Three category-2c models cannot be keyed to a person at all.**
`ContractEvent` and `ShowCampaignEscrowEvent` carry no column naming anybody:
they are keyed by contract address and block position, and the person's address
appears only inside an untyped `args` JSON blob whose shape varies per event.
`ShowEscrowIndexerState` is an indexer cursor whose `feeRecipient` is the
platform and whose `leaseOwnerId` is a worker process.

The export therefore reaches a person's on-chain activity through the typed
models that do name them — `StemPurchase`, `RoyaltyPayment`, `StemListing`,
`X402Settlement`, `ShowPledge` — rather than by scanning JSON. **Slice 3 must
not treat this as settled for erasure:** "we cannot query it by column" is a
reason the export skips it, not a reason the data is not there.

## Corrections from building the erasure (#1771 slice 3)

**4. Analytics are not always keyed by the pseudonymous `actorId`.** The table
below says `actorId` is "derived with a secret salt". That is true only of the
browser-facing controller path. `analytics_domain_event_bridge.service.ts`
declares `actorIdKeys: ["userId"]` and `subjectIdKeys: ["userId"]` for around
twenty server-emitted event types, `recordConfiguredDomainEvent` passes the
value straight through, and nothing on the ingest path pseudonymizes it — so
`AnalyticsEvent.actorId` and `AnalyticsEvent.subjectId` hold the raw `User.id`.

That mattered twice. The shipped export matched only the derived hash and so
omitted a person's server-emitted analytics while reporting a complete file
(corrected, with a regression test). And an erasure matching only the hash would
have left those rows behind.

**5. The user id is itself personal data.** For wallet and passkey accounts
`User.id` **is** the person's lowercased wallet address — `auth.controller.ts`
passes `userId: issuedAddress`, and `auth.service.ts` then writes
`email: "${userId}@wallet.resonate"`. So the address is the primary key across
43 models, a foreign key throughout, and inside the email.

This is why erasure rotates `User.id` to a fresh UUID rather than merely
scrubbing fields. It is affordable because **every foreign key in this database
is `ON UPDATE CASCADE`** — 103 of 103 across the migration history — so the
rotation reaches every relation-linked table on its own. The columns holding a
user id with *no* declared relation do not cascade, and a missed one keeps the
address forever without failing; they are enumerated in
`backend/src/modules/privacy/personal_data_erasure_manifest.ts` and a
DMMF-driven test fails when the schema gains another.

**6. A dangling column this document missed.**
`ShowCampaignDispute.resolvedByUserId` sits on a model that *does* declare a
`User` relation — on `initiatorUserId`. Any per-model "does it have a `User`
relation?" check clears the model and walks past the column.

**7. Ordering is load-bearing.** The pseudonymous actor id derives from
`userId`, so analytics must be erased **before** the id rotates. Rotate first
and every historical actor id becomes underivable — the same failure this
document already warns about for salt rotation, reachable without anyone
touching a secret.

**8. Artist claim requests carry private evidence and review text.**
`ArtistClaimRequest` is exported for the claimant by `claimantUserId`; the
reviewer account id is redacted. Erasure keeps the claim's final audit status,
scrubs the evidence and review note, and revokes an approved grant before the
claimant's user id rotates. If the erased person reviewed somebody else's
claim, only that person's review note is scrubbed.

**9. Credit review attribution has a dangling reviewer id.**
`ReleaseArtistCredit.identityReviewerUserId` has no declared `User` relation,
even though the credit itself belongs to an artist. Erasure clears that id and
`identityReviewNote` while retaining the credit's review status and timestamp.

**10. Management transfer recovery requests carry private evidence.**
`ManagementTransferRecoveryRequest` is exported only for its requester, with
the operator's account id redacted. Erasure retains the decision and resource
snapshot, scrubs the requester's evidence and review note, and rejects any
still-pending request. If the erased person reviewed someone else's request,
only that review note is scrubbed. User foreign keys rotate with the account id.

**11. Artist claim decisions now have append-only audit history.**
`ArtistClaimDecisionEvent` records each manual approve, reject or revoke and
automatic rejection of competing claims. It remains internal operator audit
history and is not included in a personal export, because its actor may be a
reviewer acting on another claimant's request. The claimant's current request
and decision remain in the `ArtistClaimRequest` export. Erasure preserves each
event's decision and timestamp, rotates `actorUserId` to the pseudonymous user
id, and scrubs its free-text note when either the claimant or actor is erased.
Deleting a claim cascades to its decision events.

## Artist follows (#1968)

`ArtistFollow` records which artists a signed-in listener follows. It is private
listener preference: no endpoint lists or counts an artist's followers, and an
artist only sees consent-gated, thresholded aggregates. The personal-data export
includes the holder's own rows (never an artist's follower list); account erasure
deletes them. The `artist.followed` / `artist.unfollowed` ledger events are
pseudonymous analytics records emitted only with a current consent grant and
remain under analytics governance (deletion, retention, withdrawal). Demand reads
count a follow only while the row exists, so unfollowing or erasure removes the
contribution from the next snapshot.

## Scene Scout aggregate snapshots (#1968)

`ShowPledgeDemandContext` holds an authenticated backer’s optional city and
country declaration, consent policy version, declaration time and 28-day expiry.
It is separate from retained financial pledges and excluded from their responses.
The personal-data export includes the holder’s rows; account erasure and consent
refusal delete them. Bounded cleanup runs on demand reads, pledge intent writes
and analytics retention runs. Current consent and taste reset controls also gate
aggregate use. The browser pledge panel collects this declaration only as an optional field shown while product analytics consent is granted.

`SceneScoutCityDemand` contains only thresholded release/city counts and catalog
labels. It is exported to the owning artist by `artistId`, never as a listener
history. The artist profile survives account erasure, and its aggregate follows
that detached profile. Listener source events remain subject to analytics
governance; dashboard reads recompute snapshots using current consent, reset
and agent-training controls. Release or artist deletion cascades the snapshot.

## Scene Scout unmet demand (#1969)

`DemandObservation` holds a user's structured crate or short-session shortfall,
keyed by a one-way source digest and canonical catalog/category values. It never
stores prompts, reasoning, session ids, raw candidate lists or free text. A
positive decision for the current analytics-consent policy is required when an
observation is written and again when it is read; session observations also
follow playback-training opt-out and taste-memory reset controls. Rows expire
after 28 days, are included in the person's export, and are deleted by
`userId` on erasure.

`DemandSignal` contains only an artist/catalog target, a fixed category, the
7- or 28-day window and thresholded counts. It has no requester, source or
session identifiers. It is exported to the owning artist and follows the
catalog through account erasure; reads recompute it from currently consented
observations and replace stale or below-threshold snapshots.

## Email notices (#2169)

`ContactEmail` is the optional address a person gives to also receive platform
notices by email. It is separate from `User.email`, which is a placeholder for
wallet accounts. It holds the address as entered and lowercased, the status
(`pending`, `confirmed`, `disabled`), the hash of the confirmation token (the
raw token exists only in the email), the confirmation, confirm and disable
dates and reason (`hard_bounce` / `complaint`), and the notice categories the
person turned off. Legal basis: consent (the address is given and confirmed by
the person); the notices themselves are sent for the reasons they already
exist. It is used for platform notices only, never marketing.

`EmailDelivery` is the outbox and delivery log: one row per (notice, recipient)
with category, status, attempt count, the error class of a failure (never an
address or body), the provider message id and dates. Content is rendered from
the notice at send time and is not stored. Rows are deleted after 180 days.

Both models are keyed by `userId`. The personal-data export includes them with
`ContactEmail.confirmTokenHash` and `EmailDelivery.providerMessageId` redacted.
Account erasure deletes both (erasure rule `delete`; the `User` row is
anonymized, not deleted, so the cascade does not do this on its own). Logs and
audit lines about email carry counts and error classes only, never addresses,
tokens or bodies. Unsubscribe links are stateless signed tokens and store
nothing.

## The problem this exists to prevent

A person is not one identifier. Resolving them requires five:

| Identifier | Where it comes from | What it reaches |
| --- | --- | --- |
| `userId` | `User.id` | the 34 models with a declared `User` relation |
| wallet address | `Wallet`, `SignupFaucetAttempt`, on-chain records | notifications, curator reputation, everything on-chain |
| pseudonymous `actorId` | derived with a secret salt | `AnalyticsEvent`, `AnalyticsGovernanceLog`, the warehouse |
| wallet `ownerAddress` | `Wallet.ownerAddress` | the EOA behind a smart account, distinct from its address |
| `artistId` | `Artist.userId` | releases, tracks, stems and everything crediting them |

Erasing by `userId` alone leaves the other four untouched.

### The actorId is only as stable as its salt

`pseudonymousAnalyticsActorId` derives the identifier as
`sha256(salt + ':' + userId)`, and the salt falls back
`ANALYTICS_ACTOR_ID_SALT` → `JWT_SECRET` → a hardcoded local constant.

**Erasure completeness depends on that salt never changing.** A deployment that
never set `ANALYTICS_ACTOR_ID_SALT` derives actor ids from `JWT_SECRET`; rotating
that secret — an ordinary security action nobody would connect to privacy —
silently makes every previously written actor id underivable. The person's
historical analytics then cannot be resolved, and an erasure request reports
success while missing all of it.

The resolver must reuse `pseudonymousAnalyticsActorId` rather than reimplement
the hash, and any deployment serving real users should set
`ANALYTICS_ACTOR_ID_SALT` explicitly and treat it as non-rotatable. Worth
verifying it is set before the first real erasure request.

## Category 1 — reachable by relation

These declare a `User` relation, so Prisma knows about them and a cascade
reaches them. Some do not use `userId` as the foreign key: a scan for that
column name alone misses the alternate keys listed below.

The non-obvious keys: `authorId` (CommunityMessage), `claimantUserId` and
`reviewerUserId` (ArtistClaimRequest), `actorUserId`
(ArtistClaimDecisionEvent, ShowCampaignEvent), `reporterUserId` (CommunityModerationReport),
`curatorUserId` (StemQualityRating),
`creatorUserId` (RemixProject), `submitterUserId` (AgentReputationFeedback),
`initiatorUserId` (ShowCampaignDispute),
`collectorUserId` (PunchlineCollectible, PunchlineUnlockGrant).

Full list: `GenerationCreditAccount`, `GenerationCreditTransaction`,
`GenerationCostRecord`, `Wallet`, `CommunityProfile`,
`CommunityVisibilitySettings`, `CommunityBadge`, `CommunityRole`,
`CommunityCohortMembership`, `CommunityBenefitRedemption`,
`CommunityMembership`, `CommunityMessage`, `CommunityModerationReport`,
`PasskeyIdentity`, `Artist`, `ArtistClaimRequest`, `ArtistClaimDecisionEvent`,
`StemQualityRating`, `RemixProject`, `RemixPartTake`, `Session`,
`AgentSignal`, `AgentPickNote`, `FirstListenerExposure`, `ListenerTasteMemorySettings`, `ListenerTasteSignalControl`,
`Playlist`, `SavedPlaylist`, `Folder`, `AgentConfig`,
`AgentReputationFeedback`, `SessionKey`, `LibraryTrack`, `ShowCampaignDispute`,
`ShowPledge`, `ShowPledgeDemandContext`, `ArtistFollow`, `ShowCampaignEvent`, `PunchlineCollectible`,
`RecommendationProfile`, `PunchlineUnlockGrant`, `Crate`, `CrateItem`,
`CrateRequest`, `DemandObservation`, `CrateQuote`, `CrateQuoteLine`,
`CrateWatchMatch`.

AI DJ Session History (#2096) adds `Session.filters`, a bounded summary of a
listening session's own filters (preset name, requested genres and moods,
energy, tempo, a My Mix flag and the explicit choice). It never holds the typed
sentence or My Mix lane details. It lives on the listener's `Session` row, so
export and erasure already cover it. A seeded session (#2244) adds `seed: { kind,
label }` to that summary (the catalog's own name for the seed track, artist or
playlist, never the seed id); the seed itself (kind, id, label) is kept only in
the server's in-memory session preferences for the live session, is left out of
the `session.started` event (which carries `seedKind` only) and out of analytics
beyond `seedKind`. Only the listener's own or public playlists can seed.

The AI DJ sentence (#2241) is never persisted. The listener's typed sentence
(500 characters at most) is processed in memory in three places and nowhere is
it stored or logged: (1) the session parse request, where the rules read it; (2)
the session's semantic query, which is sent as embedding text to the configured
embedding provider (Vertex AI when `TRACK_EMBEDDING_PROVIDER=vertex`; the offline
hash embedder and the disabled setting send nothing) and held in memory with its
vector for the live session, and which is kept in the server's in-memory session
preferences until the session ends or the instance restarts; (3) only when
`AGENT_SESSION_PARSER_STRATEGY=model-assisted` (off by default, every
environment) and only for a sentence the rules could not fully read, the same
bounded sentence plus the allowed genre and mood vocabulary is sent to the
configured model provider (Google AI) to be read into filters, with no listener
identifier in the payload. The artist names a sentence resolves to are catalog
names, sent back by the browser for the session and kept in the same in-memory
preferences; they are not written to `Session.filters`. It is excluded from the
`session.started` and `agent.track_selected` events, analytics, and
`sessionStorage`. Nothing about it needs export or erasure handling.

First-listener discovery (#1970) adds `FirstListenerExposure`, keyed by the
listener's `userId`. It records the release and time of a placement, so export
includes only that person's rows and erasure deletes them before rotating the
account id. `Release.firstListenerPlacementsUsed` is a separate catalog budget
counter; it contains no listener identity and stays monotonic after erasure so
the release cap cannot be replenished.

Crate Digger (#1962) adds three of these, all keyed by `userId`. `Crate` (title,
filters, status), `CrateItem` (track id, position, locked flag; `userId` is
denormalized from the crate) and `CrateRequest` (source, filters, parser
strategy, counts and the filter keys that left gaps) are the person's own data.
Erasure disposition: `delete` for all three, by `userId`. Export: all three are
included. **No free text is stored**: the DJ's request text is never persisted
(`CrateRequest.unparsedCount` is a count only), so the export and erasure have
no request text to cover. `Crate.title` is the one user-typed string.

Crate quotes (#1964) add two more, also keyed by `userId`. `CrateQuote` (the
marketplace, the DJ's smart-account address at quote time, expiry, submitted
transaction hash, status) and `CrateQuoteLine` (track, stem, tier, on-chain
listing and token ids, raw price units from the chain, the settlement receipt;
`userId` is denormalized from the quote) are the person's own data. Erasure
disposition: `delete` for both, by `userId`; the settled sales themselves are
chain facts and `StemPurchase` rows, which erasure does not touch. Export: both
are included. Nothing user-typed is stored.

Crate watching (#1967) adds one more, keyed by `userId`. `CrateWatchMatch` (crate
id, track id, when it matched, when a notification was sent, if ever; `userId` is
denormalized from the crate) records which new releases fit a person's watching
crates. Erasure disposition: `delete`, by `userId`; the crate delete also
cascades it. Export: included. `Crate` gains `watchMode` and `watchExpiresAt`,
which travel with the crate in both. The `crate_watch_match` notification is an
ordinary `Notification` row keyed by wallet address, which the existing export
and erasure rules already cover; its new `crateId` column holds a crate id, not
personal text. Nothing user-typed is stored beyond the existing crate title.

Admin users directory (#2166) adds two things to this category's neighbours.
`User.lastSignInAt` and `User.lastActiveAt` are operational activity timestamps
kept for account administration under legitimate interest (no consent). They
are written by `UserActivityService` (at most about once an hour per person) and
by sign-in; operators see them to the day. **Export:** included with the `User`
row. **Erasure:** set to null by the same update that rotates the id. They are
not analytics, are never read by the warehouse, and have no retention beyond the
account. `User.email` is deliberately not shown in the directory because for
wallet accounts it is a placeholder.

## Category 2 — personal, but no relation (28 models)

**No cascade reaches these.** They hold an identifier as a plain column, so
deleting a `User` row leaves them behind entirely. This is the category that
makes erasure a feature rather than a `DELETE`.

### 2a. Dangling `userId` — unambiguously the person's

`SignupFaucetAttempt`, `AgentTransaction`, `WebAuthnCredential`, `KeyAuditLog`,
`ShowEscrowReconciliationAcknowledgement` (`acknowledgedByUserId`,
`revokedByUserId`).

`AdminAuditEvent` (#2166) holds two dangling account ids: `actorUserId` (the
operator who viewed or acted on an account) and `targetUserId` (the account
viewed or restricted). It records `user.detail_viewed` and the account
suspension, unsuspension and closure actions with a `detail` of reason category
and dates, and `agent_session.events_viewed` (#2259: an admin opened a session's
raw agent events; `detail` is the session id and an event count, never the
events themselves); **an operator's free-text note is never stored in it.** Erasure
disposition: `retain` as audit history, with both columns rewritten to the new
id (an erased operator and an erased subject both stop being named). Export:
rows where `targetUserId` is the person, with `actorUserId` redacted.

`ReleaseArtistCredit.identityReviewerUserId` is another dangling account id.
The model has an `Artist` relation, but the reviewer field has no `User`
relation; erasure explicitly clears it and the associated review note.

`WebAuthnCredential` deserves naming: **authentication material with a
dangling `userId`.** A closed account whose credential row survives is the
worst member of this list.

### 2b. Keyed by wallet address

`Notification`, `NotificationPreference`, `CuratorReputation`,
`SignupFaucetAttempt`. Reachable only once the person's wallet addresses are
resolved.

**These tables hold the same address in more than one case.**
`notification.service.ts` lowercases the address on one path (line 127) and
passes the on-chain value straight through on four others (lines 61, 85, 94,
118), where it arrives EIP-55 checksummed. `SignupFaucetAttempt`'s unique
constraint is case-sensitive too, so the database can already hold two rows
that are the same address in different cases.

`PersonalDataResolverService` normalises to lowercase, so **a query of the form
`where: { walletAddress: { in: resolvedAddresses } }` would match the lowercase
rows and miss the checksummed ones** — deleting part of a person's data and
reporting success. Any slice that queries these tables must either compare
case-insensitively (Postgres supports `mode: "insensitive"`) or normalise at
write time and backfill. Deciding that is slice 3's first task, not an
afterthought.

### 2c. Mirrors of on-chain records

`StemNftMint`, `StemListing`, `StemListingIntent`, `StemPurchase`,
`RoyaltyPayment`, `X402Settlement`, `ShowCampaign`, `ContentProtectionStake`,
`ContentAttestation`, `TrustedSource`, `TrustedSourceLinkRequest`,
`ReleaseRightsUpgradeRequest`, `RightsRouteReassessment`,
`RightsEvidenceBundle`, `RightsEvidence`, `ContractEvent`,
`ShowCampaignEscrowEvent`, `ShowEscrowIndexerState`.

A wallet address is personal data, and these rows carry one. They are also
copies of a public, permanent ledger: deleting our copy does not erase the
chain, and keeping it is what lets the product show someone their own history.

**This is a decision, not an oversight**, and the privacy policy has to state
whichever way it goes. The defensible position is that these are retained as
financial and rights records with the same justification as the audit-preserved
analytics families — but that reasoning must be written in the policy, not left
implicit here.

### 2d. Analytics

`AnalyticsEvent`, `AnalyticsGovernanceLog`, keyed by `actorId`. Already handled
by `AnalyticsGovernanceService`, which since #1770 also reaches the warehouse.
Governance lineage is deliberately retained so a deletion stays provable.

## Category 3 — no personal link (19 models)

Catalogue, contract state and configuration. Verify a new model belongs here
before assuming it does.

## What follows for the implementation

1. **Resolve first, then act.** Every export and erasure starts from all five
   identifiers, not from `userId`.
2. **A cascade is not an erasure.** Category 2 needs explicit handling, and the
   ones with no relation will not fail loudly when missed — they will simply
   remain.
3. **Export is not the inverse of erasure.** Export should include category 2c
   (a person is entitled to see their own transaction history); erasure
   deliberately retains it.
4. **This list is load-bearing for a legal document.** The privacy policy
   describes what is held and what survives deletion. If they disagree, the
   policy is wrong.
