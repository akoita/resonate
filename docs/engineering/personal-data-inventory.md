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

**1. The arithmetic did not reconcile.** The categories below claim 34 + 28 + 58
models. The schema has **94**, not 120. The current classification is **75
models holding a person's data, 19 holding none**.

**2. There was a blind spot shaped like its own thesis.** This document names
five identifiers and then enumerates models reachable by `userId`, wallet
address and `actorId` — but never enumerates the ones keyed by `artistId`,
despite listing it as one of the five. Thirteen models were missing as a result,
`Release` among them. The document warning that a person is not one identifier
was itself written from fewer than five.

Added by the manifest: `Release`, `ReleaseArtistCredit`, `CreatorTrust`,
`CommunityBenefitRule`, `CommunityRoom`, `CommunityDiscordBridge`,
`TrustedSourceArtistLink`, `PunchlineDrop`, `ArtistEngagement` (all
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

## Category 1 — reachable by relation (34 models)

These declare a `User` relation, so Prisma knows about them and a cascade
reaches them. **Nine do not use `userId` as the foreign key**, which is the
trap: a scan for `userId` finds 25 of 34 and looks thorough.

The non-obvious keys: `authorId` (CommunityMessage), `reporterUserId`
(CommunityModerationReport), `curatorUserId` (StemQualityRating),
`creatorUserId` (RemixProject), `submitterUserId` (AgentReputationFeedback),
`initiatorUserId` (ShowCampaignDispute), `actorUserId` (ShowCampaignEvent),
`collectorUserId` (PunchlineCollectible, PunchlineUnlockGrant).

Full list: `GenerationCreditAccount`, `GenerationCreditTransaction`,
`GenerationCostRecord`, `Wallet`, `CommunityProfile`,
`CommunityVisibilitySettings`, `CommunityBadge`, `CommunityRole`,
`CommunityCohortMembership`, `CommunityBenefitRedemption`,
`CommunityMembership`, `CommunityMessage`, `CommunityModerationReport`,
`PasskeyIdentity`, `Artist`, `StemQualityRating`, `RemixProject`, `Session`,
`AgentSignal`, `ListenerTasteMemorySettings`, `ListenerTasteSignalControl`,
`Playlist`, `SavedPlaylist`, `Folder`, `AgentConfig`,
`AgentReputationFeedback`, `SessionKey`, `LibraryTrack`, `ShowCampaignDispute`,
`ShowPledge`, `ShowCampaignEvent`, `PunchlineCollectible`,
`RecommendationProfile`, `PunchlineUnlockGrant`.

## Category 2 — personal, but no relation (28 models)

**No cascade reaches these.** They hold an identifier as a plain column, so
deleting a `User` row leaves them behind entirely. This is the category that
makes erasure a feature rather than a `DELETE`.

### 2a. Dangling `userId` — unambiguously the person's

`SignupFaucetAttempt`, `AgentTransaction`, `WebAuthnCredential`, `KeyAuditLog`,
`ShowEscrowReconciliationAcknowledgement` (`acknowledgedByUserId`,
`revokedByUserId`).

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
