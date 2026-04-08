---
title: "Upload Rights Routing Policy"
status: proposed
owner: "@akoita"
related:
  - "../rfc/rights-verification-strategy.md"
  - "../rfc/content-protection-architecture.md"
  - "../features/artist_upload_flow_mvp.md"
  - "https://github.com/akoita/resonate/issues/467"
  - "https://github.com/akoita/resonate/issues/469"
---

# Upload Rights Routing Policy

## Goal

Define exactly how Resonate routes a newly uploaded track through rights verification before it becomes fully publishable.

This document turns the high-level strategy from [Rights Verification & Copyright Enforcement Strategy](../rfc/rights-verification-strategy.md) into operational decision rules that backend, frontend, ops, and policy work can implement consistently.

## Core Principle

> **Every upload must be classified before it receives full publishing rights.**

The system should not treat all uploads equally. It should use the available signals to decide whether to:

- block immediately,
- quarantine for ops review,
- publish with limited visibility,
- publish with standard escrow,
- publish with trusted-source privileges.

## Scope

This policy applies to the **full track upload** path. It does not independently route stems. Stems inherit the rights state of their parent track.

## Inputs To The Routing Engine

The routing decision should be based on a structured set of inputs.

### Source Trust Signals

- uploader trust tier,
- uploader verification state,
- uploader role or source type,
- whether the upload came from a trusted distributor / label / approved source,
- whether the uploader has prior clean history on the platform.

### Content Similarity Signals

- exact fingerprint match against trusted reference catalog,
- high-similarity fingerprint match,
- internal duplicate detection against existing Resonate catalog,
- suspicious reuse patterns across wallets or releases.

### Metadata Signals

- title / artist mismatch,
- ISRC / UPC collisions,
- release-date conflicts,
- inconsistent credits,
- suspicious claims involving major or known catalog artists.

### Proof-Of-Control Signals

- official artist profile linkage,
- official website / domain verification,
- distributor account linkage,
- verified social linkage,
- prior release continuity.

### Manual / External Signals

- prior takedown history,
- existing open disputes,
- trusted rightsholder complaint,
- ops notes or account sanctions.

## Decision Outputs

The engine should emit one primary routing state.

| Routing State | Meaning | User Effect |
| --- | --- | --- |
| `BLOCKED` | Upload is clearly not eligible to proceed | Upload rejected; no public release; no stem processing |
| `QUARANTINED_REVIEW` | High-risk upload requires ops review before publication | Not public; hold processing or hold release publication |
| `LIMITED_MONITORING` | Upload may proceed, but with restricted rights and elevated controls | Limited visibility, strong escrow, restricted monetization/listing |
| `STANDARD_ESCROW` | Upload may publish under standard protection controls | Public with normal escrow and monitoring |
| `TRUSTED_FAST_PATH` | Upload comes from a sufficiently trusted source | Public with lower friction, still subject to audit |

The engine may also emit secondary flags:

- `NEEDS_PROOF_OF_CONTROL`
- `NEEDS_HUMAN_REVIEW`
- `DISPUTE_ELIGIBLE`
- `MAJOR_CATALOG_RISK`
- `RESTRICT_MARKETPLACE`
- `RESTRICT_PAYOUTS`

## Routing Matrix

### 1. Exact Match To Trusted Reference

Conditions:

- exact or near-exact fingerprint match,
- reference belongs to trusted source or strong official catalog record,
- uploader lacks trusted ownership proof for that recording.

Route:

- `BLOCKED` or `QUARANTINED_REVIEW`

Default:

- block when confidence is extremely high and the uploader has no credible contrary proof,
- quarantine when there is any plausible ambiguity that needs ops review.

Example:

- User uploads a famous 50 Cent recording under another artist name.

Expected outcome:

- no jury,
- no community-led first pass,
- no normal publication,
- direct block or ops review.

### 2. High Similarity To Trusted Reference

Conditions:

- fingerprint similarity above policy threshold but below exact-match certainty,
- or strong metadata conflict with partial audio match.

Route:

- `QUARANTINED_REVIEW`

Expected handling:

- ops verifies whether this is infringement, a licensed version, a re-recording, or a legitimate derivative use.

### 3. Internal Duplicate Across Different Wallets

Conditions:

- same or nearly same audio already exists on Resonate,
- current uploader is not the original uploader,
- no trusted-source linkage explains the duplication.

Route:

- `QUARANTINED_REVIEW`

Secondary actions:

- notify original uploader,
- attach prior upload and provenance context to the review packet.

### 4. New Upload From Unverified Uploader With No Negative Signals

Conditions:

- no significant fingerprint hit,
- no metadata conflict,
- no external proof of control yet,
- uploader is new or low-trust.

Route:

- `LIMITED_MONITORING`

Restrictions:

- stronger escrow window,
- restricted marketplace / licensing privileges,
- elevated monitoring,
- potential payout hold until trust increases.

### 5. Upload From Verified Independent Artist

Conditions:

- uploader has passed proof-of-control verification,
- no strong fingerprint or metadata conflict,
- no major policy risk flags.

Route:

- `STANDARD_ESCROW`

Expected behavior:

- public publishing allowed,
- normal challenge period,
- normal dispute path if later challenged.

### 6. Upload From Trusted Distributor / Label / Official Source

Conditions:

- upload originates from approved source,
- source provides catalog traceability,
- no conflicting fingerprint or strong contrary evidence.

Route:

- `TRUSTED_FAST_PATH`

Expected behavior:

- lowest friction path,
- still fingerprinted and auditable,
- still reversible if later evidence shows source abuse or feed error.

### 7. Trusted Source Upload With Conflict

Conditions:

- trusted source upload conflicts with another trusted source or strong existing claim,
- or fingerprint / metadata indicates a serious mismatch.

Route:

- `QUARANTINED_REVIEW`

Expected behavior:

- do not auto-publish based solely on source status when trusted sources disagree.

## Publication Rights By Route

| Route | Public page | Streaming | Stem generation | Marketplace / licensing | Payout release |
| --- | --- | --- | --- | --- | --- |
| `BLOCKED` | No | No | No | No | No |
| `QUARANTINED_REVIEW` | No | No | Optional hold | No | No |
| `LIMITED_MONITORING` | Yes, limited | Yes | Yes | Restricted or disabled | Held / strongest escrow |
| `STANDARD_ESCROW` | Yes | Yes | Yes | Yes, under normal controls | Standard escrow |
| `TRUSTED_FAST_PATH` | Yes | Yes | Yes | Yes | Lowest-friction escrow / release policy |

## Ops Review Policy

Ops review should be mandatory for:

- exact or high-confidence catalog conflicts,
- major artist impersonation,
- trusted-source disagreements,
- repeated suspicious behavior by an uploader,
- disputed proof-of-control claims,
- legal notices and counter-notices.

Ops review should produce one of these outcomes:

- approve and route to `STANDARD_ESCROW`,
- approve and route to `TRUSTED_FAST_PATH`,
- keep quarantined pending more evidence,
- block / takedown,
- open or attach to dispute record,
- mark as jury-eligible only if ambiguity remains after review.

## When Community Reporting Enters

Community reporting should happen **after** the routing engine, not instead of it.

Good use cases:

- suspicious upload with weak machine signals,
- independent-artist ownership conflict,
- plagiarism or unauthorized reuse not caught by fingerprinting,
- additional external publication evidence.

Bad use cases:

- first-line detection for obvious famous-song impersonation,
- sole review path for trusted-catalog conflicts.

## When Jury Enters

Jury should only become available if:

1. the upload survived initial routing or was escalated from ops review,
2. both parties have submitted structured evidence,
3. no strong trusted-source or machine signal conclusively resolves the conflict,
4. the dispute is genuinely ambiguous.

Jury should be excluded for:

- obvious catalog theft,
- clear major-artist impersonation,
- exact-match trusted-reference conflicts,
- routine legal takedown handling.

## Required Evidence Packet

If a report is filed, the system should not accept only a free-form URL. The report payload should support:

- evidence type,
- source URL,
- claimed rightsholder,
- publication date,
- optional ISRC / UPC,
- optional notes,
- optional proof-of-control attachments,
- reporter confidence / rationale.

This packet should become the baseline evidence object shown to ops and, if necessary, to jurors.

## Uploader Trust Model

The routing engine depends on a real uploader classification model.

Minimum classes:

- `unverified_uploader`
- `verified_independent`
- `trusted_creator`
- `trusted_source_account`
- `restricted_account`

Minimum trust-affecting factors:

- proof-of-control verification,
- prior disputes and outcomes,
- prior clean uploads,
- linked trusted-source relationships,
- fraud or abuse history.

## Recommended Initial Threshold Policy

These values are placeholders and should become environment-configurable policy, not hardcoded application constants.

- exact trusted-reference match: auto-block or quarantine
- high-similarity trusted-reference match: quarantine
- internal duplicate by different wallet: quarantine
- unverified uploader with no conflict: limited monitoring
- verified independent with no conflict: standard escrow
- trusted source with no conflict: trusted fast path

The important part is the routing shape, not the exact threshold numbers.

## Required System Components

To implement this policy, the platform will need:

- rights routing service,
- fingerprint result store,
- trusted source registry,
- uploader trust profile service,
- ops review console,
- evidence schema shared across upload, disputes, and jury,
- policy configuration store for thresholds and route actions.

## API / Domain Shape

Suggested upload-rights decision object:

```ts
type UploadRightsRoute =
  | "BLOCKED"
  | "QUARANTINED_REVIEW"
  | "LIMITED_MONITORING"
  | "STANDARD_ESCROW"
  | "TRUSTED_FAST_PATH";

type UploadRightsDecision = {
  route: UploadRightsRoute;
  reasons: string[];
  flags: string[];
  requiredActions: string[];
  reviewRequired: boolean;
  disputeEligible: boolean;
  marketplaceRestricted: boolean;
  payoutRestricted: boolean;
  escrowProfile: "max" | "strong" | "standard" | "trusted";
};
```

## Product Implications

The upload UX should eventually reflect the decision route clearly.

Examples:

- blocked: explain that the upload conflicts with protected catalog evidence,
- quarantined: explain that the upload is under rights review,
- limited monitoring: explain restrictions and stronger holds,
- standard escrow: explain normal publication protections,
- trusted fast path: avoid noisy friction while preserving auditability.

Users should never be left guessing why an upload is stuck or why certain monetization actions are unavailable.

## Near-Term Implementation Order

1. define the decision object and routing states in backend domain language,
2. formalize trusted-source registry inputs,
3. implement typed evidence schema,
4. wire upload flow to emit a rights route before publication,
5. add ops review workflow,
6. update frontend upload status and dispute UX to reflect the route.

## Open Questions

- Should `QUARANTINED_REVIEW` still allow stem generation for internal use, or should processing halt entirely?
- Should `LIMITED_MONITORING` uploads be searchable publicly, or only accessible by direct link until trust improves?
- What minimum proof-of-control requirements qualify an artist as `verified_independent`?
- Which trusted distributors / labels should be supported first?
- How should DMCA-style legal notices interact with community dispute state?

## Final Recommendation

Resonate should treat upload routing as a **policy engine**, not a side effect of upload processing.

If we get this layer right:

- obvious theft is stopped early,
- legitimate artists get clearer publishing paths,
- ops review is focused where it adds real value,
- community reporting becomes more credible,
- and jury is reserved for the disputes it can actually adjudicate well.
