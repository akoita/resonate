---
title: "Copyright & Content Protection Delivery Plan"
status: draft
owner: "@akoita"
related:
  - "../rfc/content-protection-architecture.md"
  - "../rfc/rights-verification-strategy.md"
  - "./upload_rights_routing_policy.md"
  - "https://github.com/akoita/resonate/issues/404"
  - "https://github.com/akoita/resonate/issues/405"
  - "https://github.com/akoita/resonate/issues/406"
  - "https://github.com/akoita/resonate/issues/407"
  - "https://github.com/akoita/resonate/issues/408"
  - "https://github.com/akoita/resonate/issues/409"
  - "https://github.com/akoita/resonate/issues/476"
  - "https://github.com/akoita/resonate/issues/477"
  - "https://github.com/akoita/resonate/issues/492"
  - "https://github.com/akoita/resonate/issues/494"
  - "https://github.com/akoita/resonate/issues/495"
  - "https://github.com/akoita/resonate/issues/496"
---

# Copyright & Content Protection Delivery Plan

## Purpose

This document consolidates the current copyright/content-protection work into one delivery view:

- what already exists in code,
- what is already planned in RFCs and GitHub issues,
- what still needs to be added so the system can scale beyond manual review.

It is not a replacement for the RFCs. It is the execution bridge between the RFCs, the codebase, and the backlog.

## Current Position

Resonate now has a credible foundation for copyright-sensitive publishing, but it is still in the transition from:

- **policy and semantics**

to:

- **production-grade low-friction rights operations at scale**

The system is already moving in the right direction:

1. uploads are routed by rights risk instead of treated equally,
2. verification semantics are being separated cleanly,
3. typed evidence exists,
4. restricted releases can enter a review flow,
5. disputes, DMCA, and curator systems already exist as escalation layers.

What is still missing is the scale layer:

- trusted-source / distributor onboarding,
- automated proof-of-control aggregation,
- continuous route reassessment and audit,
- reducing the number of releases that need manual review at all.

## What Is Already In Place

### Implemented or largely implemented in code

These areas already have concrete code-level support:

- upload rights routing engine and route states:
  - `BLOCKED`
  - `QUARANTINED_REVIEW`
  - `LIMITED_MONITORING`
  - `STANDARD_ESCROW`
  - `TRUSTED_FAST_PATH`
- release-level content protection display and route-aware marketplace gating
- separated semantics for:
  - economic trust
  - human verification
  - provenance
  - rights review
- typed rights evidence bundles across disputes / releases
- admin review queue for release rights-upgrade requests
- creator-facing restricted-release rights-upgrade request flow
- dispute reporting and curator reputation foundations
- proof-of-humanity / anti-sybil integration path

### Already planned in the backlog

These major tracks already exist as issues or epics:

- `#404` content protection epic
- `#405` fingerprinting + DMCA
- `#406` stake-to-publish + revenue escrow
- `#407` disputes and community curation
- `#408` advanced detection and external DB coverage
- `#409` decentralized governance and cross-platform enforcement
- `#476` evidence intake and rights review workflow
- `#477` copy and badge cleanup
- `#492` manual release rights-upgrade flow
- `#494` streamlined low-friction marketplace-rights onboarding
- `#432` decentralized jury escalation
- `#433` proof-of-humanity and advanced reputation

## What Still Needs To Be Added

The remaining work is not one monolith. It breaks into four operational layers.

### 1. Automated detection and suppression

Still needed:

- stronger fingerprint integration before normal publish/mint flows
- external reference data coverage
- richer duplicate / catalog collision handling
- clearer quarantine behavior and operator tools

Primary issues:

- `#405`
- `#408`

### 2. Progressive trust and low-friction publishing

Still needed:

- trusted-source / distributor registry and account linking
- guided proof-of-control for creators with strong low-risk signals
- better distinction between:
  - direct anonymous uploads,
  - verified independent creators,
  - trusted source accounts

Primary issues:

- `#494`
- `#495`

### 3. Review operations and explicit rights outcomes

Still needed:

- complete review-state modeling from evidence to final rights outcome
- clearer mapping from review decisions to:
  - platform reviewed
  - rights verified
  - denied / more evidence needed
- stronger reviewer tooling and auditability

Primary issues:

- `#476`
- `#492`
- `#477`

### 4. Post-publish monitoring and decentralized escalation

Still needed:

- continuous monitoring of already-published releases
- route re-evaluation after new evidence, disputes, or suspicious signals
- sampling/audit on low-friction routes
- escalation from automation → ops → dispute → jury

Primary issues:

- `#407`
- `#432`
- `#409`
- `#496`

## Recommended Delivery Order

### Near-term priorities

1. Finish and land `#492`
2. Complete `#476`
3. Complete `#477`
4. Build `#494`

Why:

- These four items turn the existing architecture into a working creator + ops flow without waiting on the full decentralized end-state.

### Next scale priorities

5. Trusted-source / distributor onboarding and registry workflow
6. Continuous route reassessment and audit sampling
7. Advance `#405` fingerprint/quarantine completeness where still missing

Why:

- These are the pieces that prevent the product from collapsing into manual review as the artist count grows.

### Longer-term decentralization priorities

8. `#433` proof-of-humanity and advanced reputation
9. `#432` jury escalation
10. `#409` public verification / cross-platform / governance

Why:

- These matter, but they should sit on top of a system that already automates the obvious cases and reserves decentralized arbitration for the ambiguous ones.

## Decision Rules For Planning New Work

When adding new content-protection work, prefer these heuristics:

### Add product or backend work if it reduces manual review volume

High value:

- trusted source linking
- automated signal aggregation
- prefilled evidence
- route reassessment
- quarantine tooling

### Add smart-contract work if it strengthens enforceable consequences

High value:

- escrow state transitions
- payout restrictions
- challenge windows
- auditable dispute / review outcomes

### Avoid treating contracts as the place for fuzzy rights truth

Do not expect contracts to directly solve:

- artist identity validation,
- social/domain proof-of-control,
- metadata reconciliation,
- audio reference matching,
- nuanced copyright review.

Those belong in backend/peripheral services, with contract state used for enforcement and audit.

## Missing Backlog Items Identified By This Audit

This audit found two scale-critical gaps that were described in RFCs but were not yet cleanly represented as implementation issues:

1. trusted-source / distributor onboarding and registry workflow (`#495`)
2. continuous route reassessment and audit sampling (`#496`)

Those now exist as explicit issues so the roadmap reflects the actual scalable architecture rather than only the manual fallback path.

## Summary

The architecture is no longer missing its conceptual model. The missing work is now mostly operational:

- reduce reliance on manual review,
- make trusted and low-risk routes much easier,
- continuously re-evaluate rights state as new evidence arrives,
- reserve humans and juries for the ambiguous edge cases.

That is the realistic path to scaling from hundreds of artists to millions without abandoning either copyright integrity or the decentralized ethos.
