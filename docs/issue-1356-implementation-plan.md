# Issue #1356 — Terms validation + locked-terms correction path

Two defects found on staging: (1) create/edit accepts contract-invalid
deadlines (funding == booking → escrow reverts `InvalidDeadline` at
activation), and (2) once authority approval locks terms, there's no operator
way to fix an invalid value even with zero backers and no chain link.

Principle: strengthen terms-lock honesty — **no silent edits**; prevention +
an explicit, audited unlock path.

## 1. Deadline + dispute-window validation (backend)

`shows.service.ts` `normalizeCampaignBase(...)` is the shared normalizer for
create AND update — add validation there so both paths inherit it. Mirror the
contract (`ShowCampaignEscrow.createCampaign`):

- funding `deadline` must be in the future (`> now`) — allow a small skew
  (e.g. require `> now`; the contract checks `deadline <= block.timestamp`).
- `bookingDeadline` (when provided) must be strictly `> deadline` — the exact
  contract rule (`bookingDeadline <= deadline` reverts). Throw
  `BadRequestException("bookingDeadline must be after the funding deadline")`.
- `disputeWindowSeconds` must be within `[3600, 7776000]` (contract
  `MIN_DISPUTE_WINDOW = 1h`, `MAX_DISPUTE_WINDOW = 90d`). The current
  `DEFAULT_DISPUTE_WINDOW_SECONDS` should already be in range; validate any
  explicit input. Throw with the bounds named.

Confirm both `createDraftCampaign` and `updateDraftCampaign` route through
`normalizeCampaignBase` (they do per grep at 828/869/997) so no separate wiring
is needed. If booking deadline is validated only when present, keep that
(optional field), but if authority approval requires it, see §2.

## 2. Block authority approval on contract-invalid terms (backend)

`approveAuthority(...)` (~line 1475): before granting authorized status, assert
the campaign's terms are contract-valid — re-run the same deadline/dispute
checks against the CURRENT persisted values (not just input), because a draft
could have been created before this validation existed (like the Brooklyn
one). If invalid, throw `BadRequestException` naming the offending field and
directing the operator to fix the draft first (the terms aren't locked yet at
this point — approval is what locks them). This is the "prevent bad locks"
half: you cannot lock terms the escrow would reject.

Also assert booking deadline is present here if activation requires it (check
whether the escrow/activation path needs a non-null bookingDeadline; if yes,
require it at approval).

## 3. Correction path for already-locked terms (backend, mostly exists)

`revokeAuthority(...)` (~line 1569) already exists. Verify + ensure:
- revoke is operator-only and moves authority back to a non-authorized state
  that **unlocks editing** (the terms-lock guard should key on
  `AUTHORIZED_STATUSES`; after revoke the campaign is editable again).
- revoke is only safe with **zero confirmed backers and no on-chain link**
  for the "fix a mistake" use — but revoke may also be used mid-dispute. Do
  NOT over-restrict: keep revoke as-is if it already guards appropriately;
  the key requirement is that after a revoke on a draft with zero backers,
  `updateDraftCampaign` accepts corrected terms and a re-`approveAuthority`
  works. Add an integration test proving this full loop:
  create (valid) → approve → revoke → update deadlines → re-approve.
- Every state change already emits a lifecycle event (the pattern in this
  service) — confirm revoke + re-approve are audited (event rows). No silent
  edits: the correction is a visible revoke→edit→re-approve trail.

## 4. Frontend (light)

`web/src/app/shows/create` + the edit form: add client-side validation
mirroring the rules (booking after funding, both in the future) with inline
errors, so the operator sees the problem before submit. The server stays the
source of truth. Check `web/src/lib/shows.ts` for a shared validation helper
spot. Keep it minimal — the backend rejection is the real guard; this is UX.

The operator panel (`CampaignOperatorPanel.tsx`) already has authority
approve/revoke controls (§3) — verify the revoke button is present and, if the
campaign is authorized with zero backers, surface a hint that revoking unlocks
terms for correction. Small copy addition, not new controls if revoke exists.

## Tests

- backend unit/integration (`shows.service.integration.spec.ts`, no prisma
  mocks):
  - create with `bookingDeadline <= deadline` → 400; with past funding
    deadline → 400; with dispute window < 1h or > 90d → 400.
  - update to invalid deadlines → 400.
  - approveAuthority on a draft with invalid persisted deadlines → 400
    (seed the bad draft directly via prisma to simulate a pre-validation
    record).
  - full correction loop: create valid → approve → revoke → update deadlines
    → re-approve succeeds; assert lifecycle events recorded.
- `shows.controller.http.spec.ts`: the 400s surface as HTTP 400.
- web: form validation test if a testable helper exists; otherwise a lib-level
  validator unit test.

## Docs

- `docs/features/resonate_shows.md`: note create/edit deadline validation and
  the revoke→correct→re-approve path for locked terms (with zero backers).
- User Guide (`web/src/lib/help/content.ts`): if a Shows create/operator
  article exists, add a line that booking must be after funding and how to
  correct locked terms; skip if no such article.

## Gates

- backend: `npx tsc --noEmit`; `jest shows.controller`; integration
  `shows.service.integration` (Docker).
- web: `npx vitest run src/components/shows src/lib`; eslint changed files.
- `git diff --check` clean.
