# Issue #470 Plan: Upload Rights Routing Engine

Branch: `feat/470-upload-rights-routing-engine`

## Goal

Implement a backend rights-routing layer that classifies uploaded releases before they receive full publishing rights, persists that decision, and uses it to control catalog visibility and marketplace access.

## Current Baseline

- Upload ingestion is currently modeled primarily as a media-processing pipeline:
  - `IngestionService` accepts files and emits `stems.uploaded`
  - `CatalogService` creates releases/tracks and marks releases `ready` once stems are processed
- The repo already has some related trust and copyright signals, but they are not centralized into an upload-routing decision:
  - `TrustService` computes creator trust tiers
  - `HumanVerificationService` exists for proof-of-humanity style verification
  - `FingerprintService` detects cross-wallet duplicates and quarantines tracks
  - `MintAuthorizationService` controls whether stems can be minted, but it does not currently consider rights routing
- Public catalog behavior is still keyed mainly off `release.status in ['ready', 'published']`
- There is no persisted `UploadRightsDecision`-style object today

## First-Pass Scope

This pass will implement the operational backbone for routing without overreaching into full trusted-source integrations or rich ops UI.

### 1. Persistence model

- Add explicit rights-routing fields to `Release` and `Track`
- Persist:
  - primary route
  - route flags
  - route reason summary
  - evaluation timestamp
- Keep track-level rights state aligned with the release-level decision so stems inherit via their parent track

### 2. Central routing domain

- Introduce a dedicated backend service for rights-routing decisions
- Keep policy logic centralized and configurable rather than scattered through controllers/services
- Support at least these routes:
  - `BLOCKED`
  - `QUARANTINED_REVIEW`
  - `LIMITED_MONITORING`
  - `STANDARD_ESCROW`
  - `TRUSTED_FAST_PATH`
- Support secondary flags like:
  - `NEEDS_HUMAN_REVIEW`
  - `RESTRICT_MARKETPLACE`
  - `NEEDS_PROOF_OF_CONTROL`
  - `MAJOR_CATALOG_RISK`

### 3. Signals used in first pass

Use signals that already exist or can be derived cheaply now:

- creator trust tier from existing trust records
- verification state from creator trust / verification data already stored
- fingerprint duplicate outcomes from `FingerprintService`
- existing track content status (`clean`, `quarantined`, `dmca_removed`)
- metadata heuristics from upload payload:
  - suspicious artist/title combinations
  - claimed major-catalog artist names (policy-driven list / env-configured list)

This first pass will not attempt full external trusted distributor ingestion yet. That belongs in follow-up work tied to `#472`.

### 4. Publication controls

Use the route to change behavior in concrete places:

- `BLOCKED` / `QUARANTINED_REVIEW`
  - not returned from public catalog endpoints
  - marketplace mint authorization denied
- `LIMITED_MONITORING`
  - public catalog allowed
  - marketplace mint authorization restricted in this first pass
- `STANDARD_ESCROW` / `TRUSTED_FAST_PATH`
  - public catalog allowed
  - marketplace mint authorization allowed

This gives us real route-based behavior without needing to solve every payout/streaming rule in one issue.

### 5. Integration points

- Evaluate and persist an initial rights route when the release is created from `stems.uploaded`
- Re-evaluate track/release route when fingerprint duplication later quarantines a track
- Include rights-routing fields in release/track API responses so the state is queryable

### 6. Tests

Add automated coverage for the main routing branches:

- unverified uploader, no conflicts -> `LIMITED_MONITORING`
- verified/trusted uploader, no conflicts -> `STANDARD_ESCROW` or `TRUSTED_FAST_PATH`
- major-catalog metadata risk -> `QUARANTINED_REVIEW`
- cross-wallet duplicate / quarantined content -> `QUARANTINED_REVIEW`
- blocked/quarantined/limited routes restrict marketplace authorization as intended

## Likely File Areas

- `backend/prisma/schema.prisma`
- `backend/src/modules/ingestion/ingestion.service.ts`
- `backend/src/modules/catalog/catalog.service.ts`
- `backend/src/modules/fingerprint/fingerprint.service.ts`
- `backend/src/modules/contracts/mint-authorization.service.ts`
- `backend/src/modules/trust/trust.service.ts`
- `backend/src/modules/*` for new rights-routing domain code
- `backend/src/tests/*`

## Deliberate Non-Goals For This Pass

- full trusted distributor registry implementation
- full independent-artist proof-of-control product UX
- ops review console for quarantined uploads
- jury integration changes
- a complete evidence schema implementation from `#471`

## Main Risk

The upload pipeline was not originally built around a rights decision object, so the safest first pass is to add an explicit policy layer and route persistence while keeping existing release processing semantics stable.
