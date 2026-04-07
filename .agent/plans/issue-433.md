# Issue #433 Plan: Proof-of-Humanity Gate + Advanced Reputation

Branch: `feat/433-proof-of-humanity-reputation`

## Goal

Extend the Phase 3 dispute system with anti-Sybil gating and a richer curator reputation model, then expose the new state in user-facing onboarding and curator profile flows.

## Current Baseline

- Backend already stores `CuratorReputation`, but it only tracks `score`, `successfulFlags`, `rejectedFlags`, and `totalBounties`.
- Dispute resolution currently applies a fixed reputation delta in `contracts.service.ts`.
- The report flow still uses a static counter-stake model from the contracts layer.
- Artist onboarding exists, but there is no proof-of-humanity or curator verification flow.
- The dispute dashboard exposes only a small reputation badge and no deeper profile or badge system.

## Proposed Implementation

1. Backend reputation model and policy layer
- Extend curator reputation persistence with fields needed for decay, tiering, badges, and proof-of-humanity state.
- Add a dedicated reputation/policy service that computes:
  - effective score after decay
  - badge tier(s)
  - whether proof-of-humanity is required
  - stake multiplier / tier label for the reporter
- Keep the computation centralized so dispute endpoints, onboarding, and profile endpoints do not reimplement the rules.

2. Proof-of-humanity integration surface
- Introduce a backend verification abstraction with env-driven provider configuration and a safe local-dev fallback.
- Start with a provider contract that can support Worldcoin or Gitcoin Passport without hardcoding credentials or URLs.
- Add endpoints to read verification status and submit/refresh a verification proof.

3. Dispute/report gating
- Enforce proof-of-humanity for high-volume curators before allowing new reports once they cross the configured threshold.
- Return structured API errors that the frontend can turn into a verification prompt instead of a generic failure.
- Use the reputation policy output to expose the current counter-stake tier and requirement state to clients.

4. Frontend onboarding and curator profile UX
- Add a proof-of-humanity verification step to onboarding/account flows where it makes sense without blocking normal artist setup unnecessarily.
- Build a curator reputation profile page that shows score, activity, decay/tier status, verification state, and badges.
- Upgrade dispute-facing UI to surface stake tier / verification requirements and deep-link into the profile or verification flow.

5. Tests and docs
- Add backend unit/integration coverage for reputation calculations, threshold enforcement, and verification status handling.
- Add frontend tests for gated report behavior and profile rendering.
- Update `docs/features/community_curation_disputes.md` and any deployment docs if new env vars are introduced.

## Likely File Areas

- `backend/prisma/schema.prisma`
- `backend/src/modules/contracts/contracts.service.ts`
- `backend/src/modules/contracts/metadata.controller.ts`
- `backend/src/modules/*` for new reputation / verification services
- `web/src/app/artist/onboarding/page.tsx`
- `web/src/app/disputes/*`
- `web/src/components/disputes/*`
- `web/src/lib/api.ts`

## Risks / Open Decisions

- The issue names Worldcoin/Gitcoin Passport, but the repo currently has no provider integration. The first pass should likely define a provider abstraction and implement one concrete env-configured path rather than over-scoping into multiple vendors at once.
- Counter-stake tiering may need a backend approximation layered on top of current contract behavior unless the contract path is also updated in this sprint.
- We need to keep local development workable without requiring live third-party credentials.
