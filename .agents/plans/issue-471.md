# Issue #471 Plan: Typed Rights Evidence Schema

Branch: `feat/471-rights-evidence-typed-schema`

## Goal

Implement a reusable typed evidence model that replaces the current raw `evidenceURI`-centric dispute flow and can attach evidence to uploads before a formal dispute exists.

## Current Baseline

- The proposed target model already exists in [rights_evidence_schema.md](/home/koita/dev/web3/resonate/docs/architecture/rights_evidence_schema.md).
- The backend persistence layer is still dispute-centric:
  - `Dispute` stores a single required `evidenceURI`
  - `DisputeEvidence` stores only `submitter`, `party`, `evidenceURI`, and optional `description`
- The report API in [metadata.controller.ts](/home/koita/dev/web3/resonate/backend/src/modules/contracts/metadata.controller.ts) still files disputes with `tokenId`, `reporterAddr`, `evidenceURI`, and `counterStake`.
- The report modal in [ReportContentModal.tsx](/home/koita/dev/web3/resonate/web/src/components/disputes/ReportContentModal.tsx) still collects a single evidence URL and optional description rather than typed evidence.
- Existing dispute dashboards and admin views still render evidence as simple links.
- There is no first-class backend evidence domain that can attach to uploads, releases, or tracks before a dispute exists.

## Proposed First Pass

### 1. Persistence and domain model

- Add a first-class evidence record to Prisma instead of encoding evidence as URL-only strings.
- Model the schema around the architecture doc:
  - `subjectType`
  - `subjectId`
  - `submittedByRole`
  - `submittedByAddress`
  - `kind`
  - `title`
  - `description`
  - `sourceUrl`
  - `sourceLabel`
  - `strength`
  - `verificationStatus`
  - structured optional metadata
- Keep the initial enum set aligned with the spec:
  - `trusted_catalog_reference`
  - `fingerprint_match`
  - `prior_publication`
  - `rights_metadata`
  - `proof_of_control`
  - `legal_notice`
  - `narrative_statement`
  - `internal_review_note`
- Preserve compatibility with current disputes by keeping the top-level dispute record stable enough for existing readers while moving new detail into typed evidence rows.

### 2. Backend validation and service layer

- Introduce a dedicated evidence domain module/service in the backend instead of validating evidence ad hoc inside the contracts controller.
- Centralize:
  - allowed subject types
  - allowed roles
  - required fields per evidence kind
  - strength / verification-status normalization
  - attachment and metadata shaping
- Add request DTO validation so the backend rejects context-free submissions that only include a URL with no type/title/role context.

### 3. Upload- and dispute-level attachment

- Support evidence creation before a dispute exists by allowing subjects like:
  - `upload`
  - `release`
  - `track`
  - `dispute`
- For this issue, wire the first end-to-end path through dispute reporting while ensuring the schema itself is not dispute-bound.
- Add linkage from disputes to evidence records without requiring every evidence item to be born inside a dispute.

### 4. Report flow upgrade

- Replace the current report modal payload with a typed primary evidence submission.
- Require enough structure to satisfy the evidence spec:
  - evidence kind
  - title
  - source URL or narrative text when appropriate
  - strength
- Keep the UX constrained to one primary evidence item in the initial flow rather than trying to build full evidence bundling immediately.
- Translate the modal payload into the new backend evidence service and dispute creation path.

### 5. Read-path compatibility

- Update dispute detail responses so dashboards can read typed evidence records.
- Preserve enough backward-compatible fields for existing UI surfaces while the richer rendering is introduced.
- Defer a full evidence-viewer redesign; the first pass should at least show type/strength/verification status and the existing URL/title information.

### 6. Tests

- Add unit coverage for:
  - evidence schema validation
  - required-field rules by evidence kind
  - strength / verification-status handling
- Add at least one integration path that proves:
  - a typed evidence item can be submitted through the dispute report API
  - the evidence is persisted and returned on the read path
- Prefer a real Prisma-backed integration test rather than mocking persistence.

## Likely File Areas

- [schema.prisma](/home/koita/dev/web3/resonate/backend/prisma/schema.prisma)
- [metadata.controller.ts](/home/koita/dev/web3/resonate/backend/src/modules/contracts/metadata.controller.ts)
- [contracts.service.ts](/home/koita/dev/web3/resonate/backend/src/modules/contracts/contracts.service.ts)
- `backend/src/modules/*` for a new evidence service / validation layer
- [ReportContentModal.tsx](/home/koita/dev/web3/resonate/web/src/components/disputes/ReportContentModal.tsx)
- [DisputeDashboard.tsx](/home/koita/dev/web3/resonate/web/src/components/disputes/DisputeDashboard.tsx)
- [AdminDisputeQueue.tsx](/home/koita/dev/web3/resonate/web/src/components/disputes/AdminDisputeQueue.tsx)
- [api.ts](/home/koita/dev/web3/resonate/web/src/lib/api.ts)
- `backend/src/tests/*.spec.ts`
- `backend/src/tests/*.integration.spec.ts`

## Deliberate Non-Goals For This Pass

- full evidence bundle composition UX
- ops console workflow redesign
- juror packet UX redesign
- automated fingerprint evidence generation
- external registry / distributor integrations

## Main Risk

The current dispute implementation is tightly coupled to raw `evidenceURI` fields in both persistence and UI. The safest delivery path is to introduce typed evidence as a first-class model, adapt the report flow first, and keep legacy readers compatible while the broader ops/jury surfaces catch up.
