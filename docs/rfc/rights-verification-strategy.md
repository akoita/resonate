---
title: "RFC: Rights Verification & Copyright Enforcement Strategy"
status: proposed
author: "@akoita"
created: "2026-04-08"
related:
  - "./content-protection-architecture.md"
  - "../features/community_curation_disputes.md"
  - "https://github.com/akoita/resonate/issues/407"
  - "https://github.com/akoita/resonate/issues/465"
  - "https://github.com/akoita/resonate/issues/466"
  - "https://github.com/akoita/resonate/issues/467"
  - "https://github.com/akoita/resonate/issues/468"
  - "https://github.com/akoita/resonate/issues/469"
---

# RFC: Rights Verification & Copyright Enforcement Strategy

## Abstract

This RFC reframes Resonate's copyright strategy around a practical principle:

> **Obvious copyright theft must be stopped by automation and trusted verification before it reaches jury.**

Community reporting, staking, and jury arbitration remain important parts of the system, but they should not be the primary line of defense against clear catalog infringement. A professional music platform needs a layered model:

1. automated detection for obvious matches,
2. trusted source verification for known rightsholders,
3. platform-operated review for high-confidence conflicts,
4. decentralized dispute mechanisms only for ambiguous or contested cases.

This is a deliberate shift away from a "community-first for all disputes" interpretation. It does not abandon decentralization; it scopes decentralization to the places where it is actually defensible.

## Why A Shift Is Needed

The current direction correctly emphasizes provenance, staking, community vigilance, and dispute resolution. However, it does not yet fully answer the two hardest real-world questions:

1. How do we stop someone from uploading a famous work under a fake artist name?
2. How do we know an uploader is actually the rightsholder for a work?

For a case like "someone uploads a 50 Cent song under another name," a user report alone is too late and too weak. The system should already have several prior opportunities to catch or suppress the upload:

- fingerprint match against a known reference recording,
- metadata collision against official release data,
- mismatch between uploader trust level and claimed catalog,
- lack of verified rightsholder or distributor linkage.

If we force community reporters and jurors to handle these obvious cases manually, we create an unreliable and legally fragile system.

## Strategic Position

Resonate should operate a **layered rights assurance model**, not a purely permissionless copyright model.

### Decision 1

**Decentralized jury is for ambiguous ownership conflicts, not for straightforward catalog theft.**

### Decision 2

**Wallet control is not enough to prove artist identity.**

A wallet proves control of a key. It does not prove "I am 50 Cent," "I control this label catalog," or "I own this master recording."

### Decision 3

**Some trusted off-chain verification is necessary.**

This includes distributor verification, official profile verification, manual review, and private compliance workflows where appropriate.

### Decision 4

**Not every uploader should have the same publishing rights on day one.**

Resonate should use progressive trust and publishing privileges instead of a binary "everyone is equal" model.

## Rights Assurance Layers

### Layer 1: Automated Detection

This layer handles obvious and scalable detection before community adjudication.

Signals:

- exact or near-exact audio fingerprint matches,
- internal duplicate detection,
- metadata collisions across title, artist, ISRC, UPC, and credits,
- conflicts with trusted reference catalogs,
- suspicious reuse patterns across wallets.

Required action classes:

| Detection Result | Default Action |
| --- | --- |
| Exact match to trusted reference | Block or quarantine immediately |
| High similarity to trusted reference | Fast-track ops review |
| Internal duplicate by different wallet | Quarantine and notify |
| Weak signal only | Allow upload with elevated monitoring / escrow |

Community reporting should supplement this layer, not replace it.

### Layer 2: Trusted Source Verification

This layer recognizes that some upload sources are materially more reliable than anonymous wallets.

Trusted sources may include:

- approved distributors and aggregators,
- approved labels,
- official artist-team accounts,
- manually verified rightsholder accounts.

Principle:

> **Known, approved ingestion sources are allowed to carry stronger presumptions of validity.**

This is less decentralized than a pure wallet-only system, but it is much more realistic and aligns with how rights are actually managed in music.

### Distributor Strategy

Resonate should maintain an allowlist or partner registry for trusted distributors.

A trusted distributor integration should provide:

- source identity,
- catalog ownership metadata,
- release identifiers,
- durable traceability for takedowns and disputes.

Uploads from trusted distributors should still be fingerprint-checked, but they can move through a lower-friction path than anonymous uploads.

### Layer 3: Progressive Creator Trust

Not all creators should get identical publishing privileges.

Suggested trust classes:

| Creator Class | Description | Rights / Restrictions |
| --- | --- | --- |
| Unverified uploader | New wallet, no external proof | Private or limited visibility; no authoritative ownership presumption |
| Verified independent | Passed proof-of-control checks | Public publishing with standard escrow and monitoring |
| Trusted creator | Established clean history + verification | Lower friction, shorter holds, stronger credibility in disputes |
| Trusted source account | Distributor / label / official catalog source | Highest ingestion confidence, still subject to audit and takedown |

This preserves an open path for new artists while preventing anonymous wallets from being treated as equally credible to official catalog operators.

### Layer 4: Platform Review

This is the professional operations layer.

Platform review should handle:

- exact-match or high-confidence catalog conflicts,
- impersonation of major artists,
- claims involving trusted distributors or labels,
- urgent takedowns,
- DMCA-style requests and counter-notices,
- fraud patterns that are inappropriate for jury.

This layer is not a failure of decentralization. It is the price of operating a real rights-sensitive platform.

### Layer 5: Community Reporting

Community reporting remains valuable, but its role should be narrowed.

Best uses:

- surfacing suspicious uploads missed by automation,
- adding external publication evidence,
- identifying plagiarism or unauthorized reuse,
- escalating ambiguous ownership conflicts.

Weak uses:

- being the primary detector for obvious commercial catalog theft,
- serving as the only evidence channel,
- forcing jurors to infer copyright truth from a single URL.

### Layer 6: Decentralized Jury

Jury should exist for disputes that remain ambiguous after automation and ops review.

Good jury candidates:

- both parties present plausible ownership claims,
- multiple contributors dispute authorship or control,
- remix / derivative / collaboration rights are contested,
- no trusted reference source cleanly resolves the case.

Bad jury candidates:

- uploader copied a famous released recording,
- exact fingerprint match to a trusted rightsholder source,
- obvious impersonation of a major artist,
- clear metadata collision with official catalog records.

Jury is a resolution mechanism for contested cases, not a substitute for a rights operation.

## Evidence Model

The current "evidence URL" field is too weak for production use. Evidence should be structured and typed.

Recommended evidence classes:

| Evidence Class | Typical Strength | Examples |
| --- | --- | --- |
| Trusted catalog reference | Very high | distributor record, official label record, approved catalog feed |
| Audio fingerprint match | Very high | exact / high-confidence match |
| Prior publication proof | High | Spotify, Apple Music, YouTube OAC, Bandcamp, SoundCloud with earlier date |
| Rights metadata | Medium-high | ISRC, UPC, writers, producers, split sheets |
| Proof of control | Medium | official website verification, verified social linkage, channel ownership |
| Narrative statement | Low | plain text explanation with no corroboration |

### Required Reporter Evidence Payload

For a serious report flow, require:

- source URL,
- evidence class,
- claimed rightsholder name,
- publication date if known,
- optional ISRC / UPC,
- optional notes,
- optional supporting attachments or references.

### Required Juror View

A juror should not see only a raw URL. A juror should see:

- structured evidence from both parties,
- uploader trust level,
- fingerprint confidence,
- metadata conflicts,
- trusted-source status,
- timeline of upload and prior publication,
- a clear decision rubric.

## Identity Verification Strategy

### What We Must Reject

We should reject two extremes:

1. **"Wallet equals artist identity."** False in the real world.
2. **"Full public KYC for everyone."** Too heavy, privacy-hostile, and unnecessary for many users.

### Recommended Identity Model

Use **proof-of-control plus selective verification**, not blanket public identity disclosure.

Possible proofs:

- control of an official artist profile,
- control of official distributor access,
- control of official website/domain,
- control of verified socials,
- prior release linkage,
- private KYC or business verification where legally or financially required.

### Independent Artists

Independent artists need a viable path without requiring label relationships.

Recommended verification ladder:

1. control of one or more official public channels,
2. linkage to prior releases where available,
3. optional private identity or payout verification,
4. trust earned over time through clean uploads and successful defenses.

For artists with no public footprint and no trusted source linkage, Resonate should not grant immediate full-trust publishing status. They may still upload, but under tighter controls.

## Practical Publishing Policy

Recommended default behavior:

| Uploader Type | Publish Visibility | Monetization | Marketplace / Licensing | Review Level |
| --- | --- | --- | --- | --- |
| Unverified uploader | Limited or gated | Held / restricted | Restricted | High |
| Verified independent | Public | Allowed with escrow | Allowed with controls | Standard |
| Trusted creator | Public | Normal | Normal | Lower |
| Trusted distributor / label | Public | Normal | Normal | Lowest friction |

This lets Resonate stay open without pretending that all uploaders are equally trustworthy.

## Operational Tooling Needed

To make this strategy real, Resonate needs:

- reference fingerprint database ingestion,
- trusted source registry,
- uploader trust classifier,
- dispute evidence schema and review console,
- platform review queue for high-confidence conflicts,
- juror-facing evidence rubric,
- policy engine deciding auto-block vs review vs jury.

## Routing Policy

Every disputed or suspicious upload should be routed through a decision engine:

| Case Type | Route |
| --- | --- |
| Exact match to trusted reference | Auto-block / quarantine |
| High similarity + trusted conflict | Ops review |
| Conflicting claims with official source on one side | Ops-led adjudication with appeal path |
| Ambiguous independent-artist conflict | Structured evidence review, then jury if unresolved |
| Remix / derivative rights dispute | Ops + jury depending on ambiguity |

## Implications For Existing Plan

This RFC changes emphasis in the existing strategy:

- **Fingerprinting moves from helpful signal to mandatory first-line defense**
- **Trusted distributors and official sources become core architecture, not optional convenience**
- **Platform moderation / review becomes an explicit system component**
- **Jury becomes a specialized escalation path**
- **Independent artist verification becomes a product pillar**

## Changes Needed In Existing Docs / Issues

The repository should be updated to reflect this position:

- `content-protection-architecture.md` should clearly state that platform review is the default for obvious catalog conflicts
- `community_curation_disputes.md` should stop implying that the current dispute UI is sufficient for professional rights operations
- issue tracking should distinguish:
  - rights verification and ingestion trust,
  - evidence workflow,
  - ops review tooling,
  - juror workflow,
  - appeal workflow

## Near-Term Roadmap

### Phase A: Reality-Based Protection

- formalize trusted source / distributor policy
- add structured evidence schema
- introduce ops review path for exact and high-confidence matches
- improve report flow and creator response flow

### Phase B: Independent Artist Verification

- add proof-of-control verification paths
- add trust-tiered publishing rights
- gate monetization and licensing based on trust level

### Phase C: Real Jury

- implement juror onboarding and assignment UX
- add evidence rubric and decision support
- reserve jury for contested, ambiguous cases

## Final Position

Resonate should not frame copyright protection as:

> "The community will figure out who owns the song."

It should frame it as:

> "Resonate combines automated detection, trusted source verification, operational review, and decentralized dispute resolution to protect legitimate artists while keeping the platform meaningfully open."

That is a stronger, more honest, and more defensible strategy for a real-world music platform.
