---
title: "Remix And Contributor Credential Boundaries"
status: draft
owner: "@akoita"
related:
  - community-membership-boundaries.md
  - remix-studio.md
  - licensing-architecture.md
  - license-nft-schema.json
  - ../features/remix_studio.md
  - ../features/remix_studio_backlog.md
  - ../features/listener_community_network.md
  - https://github.com/akoita/resonate/issues/1099
  - https://github.com/akoita/resonate/issues/1114
  - https://github.com/akoita/resonate/issues/1115
  - https://github.com/akoita/resonate/issues/1116
---

# Remix And Contributor Credential Boundaries

## Purpose

This RFC defines product, rights, and protocol boundaries for remix and
contributor credentials before implementation. It follows
[Blockchain-Native Community Membership Boundaries](community-membership-boundaries.md),
[RFC: Remix Studio](remix-studio.md), and
[Licensing Architecture](licensing-architecture.md).

Remix and contributor credentials are different from supporter, collector, or
attendance badges. They can represent public creative attribution and licensed
derivative provenance, so they must align with Remix Studio publication,
catalog rights, License NFT metadata, and ancestry/royalty surfaces. They
should not become a standalone community-only token detached from the actual
rights record.

## Recommendation

Do not mint a standalone community-only remix or contributor credential.

The recommended first path is:

1. use Remix Studio, catalog publication, source release/stem rights, license
   state, and artist/rightsholder approval as the source of truth;
2. create off-chain, publication-scoped attribution proofs first;
3. require explicit public display opt-in before a credential appears on a
   profile or verifier surface;
4. keep private drafts, unreleased collaborations, prompts, source work-in-
   progress, private split details, and operator review notes hidden;
5. expose a privacy-safe verifier API only after publication/display rules are
   implemented;
6. integrate with License NFT and ancestry surfaces only after Remix Studio can
   publish derivative works with attribution and lineage;
7. consider protocol-level credentials only when they are license, provenance,
   royalty, or rights-verification records, not social badges.

This keeps creative recognition tied to legal/provenance truth and avoids
issuing public credentials for work that is private, disputed, unpublished, or
not rights-cleared.

## Selected First User Story

The first user story should be **published remix attribution and contributor
recognition inside Resonate**.

Example:

> A producer publishes a licensed remix through Remix Studio. The release page
> shows source attribution and contributor roles, the producer can opt in to
> display a "Published remixer" credential, and a verifier can confirm the
> public attribution without exposing private prompts, unreleased stems,
> collaborator contact details, wallet/payment data, private split rules, or
> dispute notes.

This should be solved before broad partner credentials or NFT-backed public
badges. It is directly tied to Remix Studio's value: licensed creation,
attribution, payment, and provenance in one workflow.

Deferred user stories:

- standalone contributor reputation NFTs;
- moderation, curation, or community-programming credentials not tied to
  rights/provenance;
- off-platform contributor passports;
- public credentials for private drafts or rejected submissions;
- protocol credentials before License NFT and ancestry integration are ready.

## Decision Summary

| Question | Rule |
| --- | --- |
| First credential path | Off-chain, publication-scoped attribution proof first. |
| First product use case | Published remix and contributor recognition inside Resonate. |
| Standalone community-only token | Do not build. Use Remix Studio, catalog, licensing, and provenance truth. |
| License NFT relationship | Future protocol proof should extend or reference License NFT / ancestry surfaces, not duplicate them. |
| Transferability | Attribution credentials are non-transferable. Transferable rights belong to license NFTs only when license terms allow transfer. |
| Revocation | Required for removal, unpublish, quarantine, rights dispute, takedown, license revocation/expiry, artist approval revocation, and user opt-out. |
| Public display | Requires explicit opt-in and a public/published qualifying source. |
| Public metadata | Public release/remix/source references, role category, publication status, rights/proof method category, timestamps, and public profile id when applicable. |
| Private data | Never publish private prompts, unreleased stems, private drafts, collaborator contact info, private split details, wallet/payment data, raw license policy JSON, dispute notes, moderation notes, or takedown details. |

## Qualifying Contribution Types

### Qualify First

| Contribution Type | Qualifying Event | First Credential Form |
| --- | --- | --- |
| Published remix release | Remix Studio or catalog publishes a derivative with valid license/rights state and source attribution. | Off-chain public attribution proof. |
| Source stem contribution | Contributor is credited on a public release/stem and the release is not blocked, quarantined, disputed, or unpublished. | Off-chain contributor proof; protocol split/licensing truth later. |
| Production or writing credit | Public catalog credit is approved by artist/rightsholder and release is published. | Off-chain contributor proof. |
| Approved curator/programming credit | Explicit artist/operator approval for a public, music-native contribution such as official playlist programming, drop programming, or campaign programming. | Off-chain badge only; not a License NFT. |

### Defer Or Exclude

| Contribution Type | Rule |
| --- | --- |
| Private Remix Studio draft | Excluded from public credentials. |
| Unpublished collaboration | Excluded unless all parties approve a public credit surface. |
| Rejected remix submission | Excluded. |
| Private prompt engineering | Excluded by default; can be stored as project provenance but not public credential data. |
| Moderation or community helper work | Use community/moderation recognition rules, not Remix/license credentials. |
| Campaign support | Covered by supporter credential rules, not contributor credentials. |
| Upload-only activity without publication | Excluded until catalog publication or explicit approval exists. |

## Credential Models

### Phase 1: Off-Chain Publication-Scoped Attribution Proof

Use this model first.

- Stored by Resonate as product state or derived from catalog/remix records.
- Tied to a public release, published remix, source stem, or approved public
  contribution.
- Hidden by default unless the existing public release page already displays
  the credit as catalog metadata.
- Public profile display requires explicit opt-in.
- Non-transferable.
- Revocable or hidden immediately when rights, publication, moderation, or
  visibility state changes.
- Does not require public token metadata or wallet identity.

Proof inputs can include:

- Remix Studio project publication;
- catalog derivative publication;
- valid remix license or artist-owner access;
- public release/stem credit;
- artist/rightsholder approval;
- future License NFT and ancestry proof once implemented.

### Phase 2: Privacy-Safe Verifier

Use a backend verifier after opt-in display and publication rules exist.

The verifier should answer a narrow question:

> Does this public profile or authorized partner session currently have an
> active, opted-in remix/contributor credential for this public release,
> remix, source stem, or approved contribution?

It must not expose the full project, prompt, private collaboration, raw license
policy, split configuration, payment history, dispute record, or moderation
state.

### Phase 3: License NFT And Lineage Integration

Use protocol surfaces only when the credential is actually a rights/provenance
record.

Acceptable future candidates:

- License NFT metadata for remix rights;
- ancestry tracker record for a published derivative;
- recursive royalty lineage record;
- machine-readable receipt for a published remix license and attribution chain;
- source stem contribution tied to split/royalty truth.

Do not mint a protocol credential for:

- private drafts;
- unpublished remixes;
- rejected submissions;
- informal community status;
- moderation roles;
- curation or programming work with no licensing/provenance implication;
- disputed or quarantined works.

## Relationship To Remix Studio

Remix Studio remains the product source of truth for remix projects.

Rules:

- a private `RemixProject` is not a public credential;
- generation metadata is provenance, not public profile copy by default;
- publish/export/monetize are separate rights and must remain separate
  credential gates;
- `remix.published` is the earliest normal event that can create public
  attribution proof;
- blocked, quarantined, rights-limited, or policy-rejected projects must not
  create public credentials;
- AI-generated and human-made remixes use the same credential rules.

The credential path should reuse Remix Studio's planned lifecycle:

1. eligibility check;
2. project creation;
3. license or artist-owner proof;
4. draft generation/editing;
5. publication;
6. attribution and lineage display;
7. future License NFT / ancestry recording.

## Relationship To License NFTs

License NFTs represent rights. Contributor credentials represent attribution.
They can be linked, but they should not be conflated.

Rules:

- a remix license NFT can be transferable only when the license terms allow it;
- an attribution credential is non-transferable even when a license is
  transferable;
- if a license transfers, attribution does not transfer with it;
- if a remix release is published, the public attribution proof can reference
  license/provenance state without exposing private payment or wallet fields;
- if LicenseRegistry or ancestry tracking later becomes protocol truth, the
  credential should reference that surface rather than minting a separate
  community-only token.

## Transferability Rules

| Surface | Transfer Rule | Reason |
| --- | --- | --- |
| Off-chain remix attribution proof | Non-transferable | It recognizes a creator's contribution. |
| Off-chain contributor proof | Non-transferable | Credits follow the credited person/entity, not an asset buyer. |
| Remix License NFT | Transferable only when license terms allow | Rights transfer is a licensing question, not a social credential question. |
| Published remix lineage record | Non-transferable record | Lineage describes source relationship and should not be sold separately. |
| Future contributor protocol credential | Default non-transferable or reference-only | Avoid resale markets around attribution or reputation. |

Transfer of a license, stem NFT, release ownership, or wallet must never
automatically transfer contributor attribution, profile display, public
credential opt-in, moderation state, or artist approval.

## Revocation, Expiry, And Rights Lifecycle

Every credential path must define rights lifecycle behavior before launch.

Revocation or hiding triggers:

- listener/creator disables public display;
- release is unpublished, removed, blocked, or quarantined;
- remix project is deleted or withdrawn before publication;
- rights route changes to blocked or review-only;
- source work receives a valid takedown or rights dispute restriction;
- license expires, is revoked, or no longer grants publication/export rights;
- artist/rightsholder approval is revoked;
- attribution is corrected or disputed;
- moderation ban/removal blocks public community display;
- policy, fraud, or trust review invalidates the proof.

Expiry rules:

- attribution can remain historical only while the published work remains
  publicly valid or policy explicitly preserves credit after removal;
- reward or partner access based on contributor status should expire or refresh;
- expired licenses should hide verifier eligibility when the license no longer
  permits the asserted use;
- removed or disputed works should fail closed until policy resolves the
  public display state.

## Rights Dispute And Unpublished-Release Handling

| State | Credential Rule |
| --- | --- |
| Private draft | No public credential. |
| Submitted but not approved | No public credential unless an explicit public submission program allows it. |
| Published remix | Eligible for attribution proof if rights/license state is valid. |
| Unpublished by creator | Hide public credential unless policy allows historical credit. |
| Removed by platform | Hide or revoke public credential. |
| Quarantined/review | Fail closed; do not verify publicly. |
| Rights dispute open | Hide or mark unavailable; do not expose dispute details. |
| DMCA/takedown accepted | Revoke or hide public credential and verifier response. |
| License expired | Hide verifier eligibility for uses no longer permitted; historical attribution requires policy. |
| License revoked | Fail closed unless grandfathered publication policy explicitly applies. |
| Attribution correction | Reissue or update off-chain proof; avoid immutable incorrect public metadata. |

## Public Metadata Boundary

Phase 1 should expose a backend/public verifier schema, not on-chain metadata.

Draft schema:

```json
{
  "schemaVersion": "remix-contributor-credential/v1",
  "credentialId": "cred_...",
  "credentialType": "published_remixer | source_contributor | producer_credit | writer_credit | curator_credit",
  "displayLabel": "Published remixer",
  "subjectProfileId": "public-profile-id-or-null",
  "artistId": "artist-id-or-null",
  "artistDisplayName": "Artist Name",
  "releaseId": "release-id-or-null",
  "releaseLabel": "Release title",
  "sourceReleaseId": "source-release-id-or-null",
  "sourceStemIds": ["stem-id-or-null"],
  "roleCategory": "remixer | producer | writer | stem_contributor | curator | programmer",
  "publicationStatus": "published | hidden | revoked",
  "rightsStatus": "valid | expired | revoked | disputed | unavailable",
  "visibility": "public_profile | partner_verifier",
  "issuedAt": "2026-06-07T00:00:00.000Z",
  "updatedAt": "2026-06-07T00:00:00.000Z",
  "proofMethod": "remix_publication | catalog_credit | license_proof | artist_approval | operator_grant",
  "verificationPath": "/community/credentials/cred_..."
}
```

Allowed public fields:

- credential id that is not a wallet address;
- credential type;
- display label;
- public artist, release, remix, and source references;
- contribution role category;
- publication status when safe;
- rights/proof method category;
- issue/update timestamps;
- public profile id only when the profile is public.

Forbidden public fields:

- private prompt text;
- private generation metadata beyond approved provider/provenance category;
- private drafts, unreleased stems, unpublished files, or private project ids;
- collaborator emails, internal user ids, auth ids, or private profile ids;
- private split percentages or payout routing unless already public contract
  truth;
- wallet addresses unless the user explicitly performs wallet-level
  verification for that partner session or the protocol surface requires it;
- payment amounts, license purchase price, royalty history, or settlement
  details;
- raw license policy JSON;
- rights dispute details, takedown notices, moderation reports, bans, appeals,
  or operator notes.

If a future on-chain metadata schema is proposed, it must be part of the
License NFT, ancestry, or derivative-work protocol plan and preserve the same
allowed/forbidden split.

## Opt-In And Visibility Rules

Contribution and contribution display are separate states.

Required controls:

- creating a remix project does not create a public credential;
- publishing a remix does not automatically add the credential to the
  contributor's public profile;
- public profile display requires explicit opt-in per credential or credential
  class;
- external verification requires explicit partner connection or one-time
  authorization unless the source is already a public protocol proof;
- disabling display removes the credential from profile responses;
- private, community-only, or follower-only profiles do not create public
  credential pages;
- contributors must be able to hide public profile recognition even when the
  release page keeps required attribution copy.

Recommended default copy:

- "Show this remix credit on my public profile";
- "Let partners verify this published remix credit";
- "This does not reveal private drafts, prompts, wallet address, payment
  details, or dispute notes."

## Privacy And Moderation Rules

Public remix and contributor credentials must not weaken creator safety or
rights enforcement.

Rules:

- moderation bans/removals override community display and partner verification;
- public credential pages must not expose reports, bans, removals, appeals,
  rights dispute details, or takedown evidence;
- partner verification should fail closed when publication or rights state
  cannot be verified;
- platform removal, quarantine, or accepted takedown should hide verifier
  eligibility;
- profile deletion or privacy downgrade removes public display;
- artists/operators need a way to correct attribution without creating
  immutable incorrect public metadata;
- abuse handling must treat credentials as attribution and eligibility hints,
  not as an entitlement to message, bypass rights review, or avoid moderation.

## Account Recovery Rules

Phase 1 off-chain attribution proofs:

- follow the Resonate account or credited profile/entity;
- can be re-evaluated after wallet recovery or wallet replacement;
- can preserve public display if the recovered account still maps to the
  credited contributor and the opt-in remains active;
- should not publish old wallet addresses or payment identifiers as credential
  identity.

Future protocol proof:

- license transfer can move rights only when terms allow it;
- attribution should not move with license transfer;
- non-transferable contributor protocol credentials are blocked until recovery,
  replacement, revocation, and correction semantics are designed.

## External Use Case Priority

Recommended order:

1. **Public release/remix attribution inside Resonate** because it is the core
   product promise.
2. **Privacy-safe verifier API** for artist sites, partner tools, and agents
   that need to confirm a public contribution.
3. **License NFT / lineage integration** once published remix and license state
   exist.
4. **Partner or platform credential portability** only after publication,
   dispute, takedown, and attribution-correction handling are proven.
5. **Standalone contributor protocol credential** only if License NFT and
   lineage surfaces cannot represent the needed proof.

## Implementation Follow-Ups

This RFC recommends documentation and product rules only. It does not implement
schemas, APIs, Remix Studio publication, verifier endpoints, partner
integrations, LicenseRegistry changes, ancestry tracking, or contracts.

Recommended follow-up issues:

1. [#1114](https://github.com/akoita/resonate/issues/1114): off-chain
   publication-scoped remix/contributor attribution proof controls;
2. [#1115](https://github.com/akoita/resonate/issues/1115): privacy-safe
   remix/contributor credential verifier API;
3. [#1116](https://github.com/akoita/resonate/issues/1116): License NFT /
   lineage integration for published remix contributor credentials;
4. account-recovery rules for future non-transferable contributor protocol
   credentials;
5. future contributor protocol credential RFC only if License NFT / lineage
   integration cannot represent the required proof.

## Non-Goals

- No Solidity implementation.
- No Prisma schema migration.
- No backend endpoint implementation.
- No frontend badge UI implementation.
- No Remix Studio implementation.
- No LicenseRegistry or ancestry tracking implementation.
- No new deploy variables or contract addresses.
- No standalone community-only contributor token.
