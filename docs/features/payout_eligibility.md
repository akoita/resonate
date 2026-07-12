---
title: "Payout Eligibility Gating"
status: implemented
owner: "@akoita"
audiences: ["artists", "operators", "backend/frontend developers"]
issue: "https://github.com/akoita/resonate/issues/1498"
---

# Payout Eligibility Gating (ADR-BM-5)

A fail-closed authorization gate that lets an artist be the destination of a
money-bearing authorization **only** when they are human-verified and their
catalog's rights state allows payouts. Money settles on-chain; the backend's
lever is refusing to authorize a payout to an ineligible destination.

- **Revenue line / phase:** vision-neutral trust/quality infra that protects
  revenue lines (1) Shows campaign fees and (3) marketplace take-rate. It
  enforces ADR-BM-5 (payout eligibility) and does not introduce or change any
  fee, split, or price — the 85%+ artist share (ADR-BM-4) is untouched.
- **Status:** `implemented` for the gate, the self-serve endpoint, and the
  honest UI. Deferred items are listed under [Remaining work](#remaining-work).

## Who it's for

- **Artists / producers / curators** who open a paid Shows campaign or mint a
  stem for sale — they see an honest "why + how to fix" before they hit a wall.
- **Operators** who designate beneficiaries — their designated (non-self)
  beneficiaries are intentionally not gated by this check.
- **Backend/frontend developers** wiring new payout-bearing seams.

## The four rules (all must hold)

The pure policy `evaluatePayoutEligibility` (in
`backend/src/modules/rights/payout-eligibility.policy.ts`) fails closed unless
**every** rule holds:

1. `humanVerificationState === "human_verified"` — the creator passed a
   personhood / anti-sybil check.
2. `rightsReviewState ∈ { approved_with_limits, rights_verified }` — the artist
   has a release whose rights review reached the standard or trusted route.
3. `payoutRelease !== "none"` — the route releases payouts.
4. `!rightsFlags.includes("RESTRICT_PAYOUTS")` — no open payout restriction.

Each failing rule returns a stable reason `code`, a plain-language `message`,
and a `resolution` naming the exact unblock step:

| Code | Meaning |
| --- | --- |
| `human_verification_required` | Account is not human-verified. |
| `rights_review_required` | No release has passed rights review (also returned for artists with zero releases). |
| `payout_release_blocked` | The catalog's rights route does not release payouts. |
| `payouts_restricted` | `RESTRICT_PAYOUTS` flag is set pending rights review. |
| `artist_profile_required` | Service-level: the caller has no artist profile to evaluate. |

**Scope note:** `payoutRelease === "held"` (escrow-days timed release) is **out
of scope** for this slice — `held` counts as eligible for the payout-release
rule; a held route is instead blocked by its `RESTRICT_PAYOUTS` flag. The timed
"held" accounting is deferred (see [Remaining work](#remaining-work)).

## Gating seams (fail-closed)

- **Shows beneficiary** — `ShowsService.normalizeCampaignBeneficiary`
  (`backend/src/modules/shows/shows.service.ts`), in the self-serve branch that
  binds the artist's own `payoutAddress`, calls
  `assertEligible(artistId, "shows_beneficiary")`. This runs at draft creation,
  draft update, and the authority-request path — so an ineligible artist cannot
  reach an authorized, activatable campaign with themselves as beneficiary.
  Operator/admin-designated beneficiaries are **not** gated.
- **Marketplace mint** — `MintAuthorizationService.prepareAuthorization`
  (`backend/src/modules/contracts/mint-authorization.service.ts`), right after
  `assertMarketplaceAllowedForStem`, calls
  `assertEligible(sellerArtistId, "marketplace_mint")` for the stem/release
  owner (the artist the sale proceeds flow to).

Both throw `ForbiddenException` with `{ code: "payout_not_eligible", context,
reasons }` so the client renders the same explainable list.

## Self-serve endpoint

`GET /api/trust/me/payout-eligibility` (JWT) →
`PayoutEligibilityService.checkForUser`. Returns the full explainable result —
`eligible`, `reasons[]` (each with `message` + `resolution`), and the `inputs`
states it evaluated. A user with no artist profile gets a 200 with
`eligible:false` and an `artist_profile_required` reason (never a 404).

## UI surfaces

- `web/src/lib/api.ts` — `fetchPayoutEligibility(token)` + types.
- `web/src/components/payments/PayoutEligibilityNotice.tsx` — shared, honest
  notice: eligible → subtle confirmation; ineligible → each reason's message and
  resolution, with the human-verification reason wired to an action.
- Artist onboarding (`web/src/app/artist/onboarding/page.tsx`) — banner under
  the payout field; the human-verification reason scrolls to the existing
  `HumanVerificationCard`.
- Shows draft form (`web/src/components/shows/CampaignDraftForm.tsx`) — the same
  notice near the beneficiary field for self-serve artists, shown before the
  server gate rejects.
- In-app User Guide: "Run a Shows campaign" (`shows-run`) and "List & manage
  your stems" (`marketplace-sell`) explain the verified-human requirement and
  where to verify.

## How to test

- Pure policy: `cd backend && npx jest --testPathPattern='payout-eligibility.policy'`
- HTTP contract: `cd backend && npx jest --testPathPattern='trust.controller'`
- Integration (Testcontainers): `cd backend && npx jest --runInBand --forceExit --config jest.integration.config.js --testPathPattern='payout-eligibility'`
- Web: `cd web && npx vitest run src/components/payments/PayoutEligibilityNotice.test.tsx`

## Remaining work

Tracked on [#1336](https://github.com/akoita/resonate/issues/1336) and
[#1164](https://github.com/akoita/resonate/issues/1164):

- `payoutRelease === "held"` timed escrow-days release semantics.
- DDEX AI labeling and fully-AI payout policy inputs.
- Any future money-bearing seam (new payout destinations) must call
  `PayoutEligibilityService.assertEligible` at its earliest control point.

## Code references

- `backend/src/modules/rights/payout-eligibility.policy.ts`
- `backend/src/modules/trust/payout-eligibility.service.ts`
- `backend/src/modules/trust/trust.controller.ts`
- `backend/src/modules/shows/shows.service.ts`
- `backend/src/modules/contracts/mint-authorization.service.ts`
- `backend/src/tests/payout-eligibility.policy.spec.ts`
- `backend/src/tests/payout-eligibility.integration.spec.ts`
- `backend/src/tests/trust.controller.http.spec.ts`
