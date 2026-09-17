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

## Category 3 — no personal link (58 models)

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
