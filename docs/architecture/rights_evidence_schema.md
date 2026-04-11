---
title: "Rights Evidence Schema"
status: implemented
owner: "@akoita"
related:
  - "./upload_rights_routing_policy.md"
  - "../rfc/rights-verification-strategy.md"
  - "../features/community_curation_disputes.md"
  - "https://github.com/akoita/resonate/issues/469"
---

# Rights Evidence Schema

## Goal

Define a typed evidence model that can be reused across:

- upload review,
- dispute reports,
- creator responses,
- ops review,
- juror review.

This replaces the current weak model of a single evidence URL plus optional free text.

Current implementation status:

- typed evidence bundles are persisted in the backend domain model
- evidence supports strength and verification status
- evidence can attach to `upload`, `release`, `track`, and `dispute` subjects
- the dispute/report flow now submits typed evidence instead of relying on a raw URL alone
- legacy dispute evidence remains readable while richer typed evidence is rolled out

## Design Principles

1. Evidence must be typed, not just linked.
2. Evidence must support machine evaluation and human review.
3. The same schema should work before and after a formal dispute exists.
4. Proof-of-control artifacts and infringement artifacts should live in the same evidence family, not in separate ad hoc forms.

## Evidence Object

Each evidence item should be a first-class record.

Suggested fields:

```ts
type EvidenceRole =
  | "reporter"
  | "creator"
  | "ops"
  | "trusted_source"
  | "system";

type EvidenceKind =
  | "trusted_catalog_reference"
  | "fingerprint_match"
  | "prior_publication"
  | "rights_metadata"
  | "proof_of_control"
  | "legal_notice"
  | "narrative_statement"
  | "internal_review_note";

type EvidenceStrength = "low" | "medium" | "high" | "very_high";

type EvidenceObject = {
  id: string;
  subjectType: "upload" | "release" | "track" | "dispute";
  subjectId: string;
  submittedByRole: EvidenceRole;
  submittedByAddress?: string | null;
  kind: EvidenceKind;
  title: string;
  description?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  claimedRightsholder?: string | null;
  artistName?: string | null;
  releaseTitle?: string | null;
  publicationDate?: string | null;
  isrc?: string | null;
  upc?: string | null;
  fingerprintConfidence?: number | null;
  strength: EvidenceStrength;
  verificationStatus: "unverified" | "verified" | "rejected" | "system_generated";
  attachments?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
};
```

## Required Core Fields

All evidence items should include:

- subject binding,
- submitting role,
- evidence kind,
- human-readable title,
- machine-readable strength,
- verification status,
- timestamp.

## Evidence Kinds

### 1. `trusted_catalog_reference`

Use for:

- distributor records,
- label catalog records,
- approved partner feeds,
- internal trusted source assertions.

Typical metadata:

- source system,
- catalog identifier,
- ownership scope,
- confidence reason.

### 2. `fingerprint_match`

Use for:

- exact or near-exact audio matches,
- internal duplicate matches,
- trusted reference catalog hits.

Typical metadata:

- matched asset id,
- matched source,
- confidence score,
- algorithm / model version,
- exact-match boolean.

This kind should usually be `system_generated`.

### 3. `prior_publication`

Use for:

- Spotify,
- Apple Music,
- YouTube OAC,
- Bandcamp,
- SoundCloud,
- official website release pages.

Typical metadata:

- platform,
- publication timestamp,
- canonical artist string,
- region if relevant.

### 4. `rights_metadata`

Use for:

- ISRC,
- UPC,
- writers / producers,
- splits,
- release metadata package.

Typical metadata:

- raw identifiers,
- source registry,
- confidence or mismatch notes.

### 5. `proof_of_control`

Use for:

- official artist profile claim,
- official site/domain verification,
- social verification,
- distributor dashboard control,
- payout/business verification when applicable.

Typical metadata:

- proof method,
- verified handle or domain,
- verifier,
- scope of proof.

This kind is essential for independent-artist verification.

### 6. `legal_notice`

Use for:

- takedown notices,
- counter-notices,
- rights complaints from representatives,
- legal correspondence references.

Typical metadata:

- notice type,
- claimant,
- representative,
- jurisdiction,
- response deadline.

### 7. `narrative_statement`

Use for:

- plain-text explanation,
- contextual notes from reporter or creator,
- unsupported claim that still matters for review.

This should exist, but should never be treated as strong evidence by itself.

### 8. `internal_review_note`

Use for:

- ops notes,
- moderation findings,
- trusted source follow-up,
- review outcomes that should remain internal.

## Evidence Strength Policy

Default guidance:

| Kind | Default Strength |
| --- | --- |
| trusted catalog reference | very_high |
| fingerprint match | high to very_high |
| prior publication | high |
| rights metadata | medium to high |
| proof of control | medium |
| legal notice | medium to high |
| narrative statement | low |
| internal review note | context-dependent |

Strength should be overrideable by policy and verification status.

## Verification Status

Each evidence item should track whether Resonate has validated it.

| Status | Meaning |
| --- | --- |
| `unverified` | user-submitted but not yet confirmed |
| `verified` | confirmed by system or reviewer |
| `rejected` | deemed invalid / misleading / irrelevant |
| `system_generated` | produced by trusted automation or internal service |

This prevents the UI from displaying all evidence as equally credible.

## Bundles

Many workflows need multiple evidence items together. Support bundling.

Suggested wrapper:

```ts
type EvidenceBundle = {
  id: string;
  subjectType: "upload" | "release" | "track" | "dispute";
  subjectId: string;
  submittedByRole: EvidenceRole;
  submittedByAddress?: string | null;
  purpose:
    | "upload_review"
    | "dispute_report"
    | "creator_response"
    | "ops_review"
    | "jury_packet";
  summary?: string | null;
  evidenceIds: string[];
  createdAt: string;
};
```

## Minimum Report Payload

For a user-submitted dispute report, the UI should require at least:

- one primary evidence item of kind:
  - `prior_publication`, or
  - `trusted_catalog_reference`, or
  - `rights_metadata`, or
  - `proof_of_control`
- one narrative summary
- claimed rightsholder name

Optional but encouraged:

- publication date,
- ISRC / UPC,
- multiple corroborating links.

The report flow should reject a completely context-free URL.

## Minimum Creator Response Payload

A creator response should support:

- proof-of-control item,
- narrative explanation,
- optional rights metadata,
- optional legal notice / license documentation,
- optional prior-publication evidence if the creator published elsewhere first.

## Ops Review Packet

Ops should see:

- all user-submitted evidence,
- system-generated fingerprint evidence,
- uploader trust tier,
- source classification,
- prior disputes,
- internal notes,
- decision recommendation.

## Juror Packet

Jurors should see a curated, review-safe subset:

- reporter evidence,
- creator evidence,
- verified system signals,
- timeline,
- plain-language decision rubric.

Jurors should not need to infer the entire case from raw URLs and timestamps.

## Storage Guidance

Evidence records should be stored independently from disputes so they can be attached earlier in the upload lifecycle.

Recommended relationships:

- upload can have evidence,
- release / track can have evidence,
- dispute can reference evidence,
- ops review can reference evidence bundles,
- trusted source assertions can generate evidence records.

## UI Implications

The frontend should eventually render evidence by:

- kind,
- strength,
- verification status,
- source.

Example display treatments:

- verified fingerprint match: strong system badge,
- trusted catalog reference: trusted-source badge,
- unverified user URL: lower-confidence user evidence badge,
- proof-of-control: ownership proof badge.

## Near-Term Recommendation

Implement this in stages:

1. add the domain model and enums,
2. expand dispute report UI to collect typed evidence,
3. add creator response evidence flow,
4. add ops review rendering,
5. add juror packet rendering.

## Final Position

A rights-sensitive platform should not ask users and jurors to decide ownership from an unlabeled URL blob.

Resonate needs evidence objects that carry:

- what this evidence is,
- who submitted it,
- how strong it is,
- whether it has been verified,
- and how it fits into the decision process.
