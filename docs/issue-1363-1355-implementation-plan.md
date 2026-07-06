# Issues #1363 + #1355 — Operator guidance + fee-era fixtures (Sprint 3 close)

Two small, related shows-ops items batched into one PR.

## #1363 — Operator panel inline guidance

`web/src/components/shows/CampaignOperatorPanel.tsx`. #1390 already added escrow
prefill + "Find on-chain campaign", so this is guidance/hints only:

1. **Activation help text**: under the Activation fields, a short caption:
   "Create the on-chain campaign first (Actions → Smart Contract Deployment →
   create-show-campaign); its run log prints the CAMPAIGN_ID — or use Find
   on-chain campaign above." Link the operations runbook
   (`docs/smart-contracts/operations-runbook.md`) — use the same relative-link
   or external GitHub-URL convention other operator copy uses.
2. **Disabled-state hints on every lifecycle button** stating the unlock
   condition. The buttons and their gates already exist (lines ~243–397):
   - Approve authority: `title` when disabled → "Available on a draft campaign
     whose authority is not yet approved" (and "requires a beneficiary
     address" when `!beneficiaryAddress`).
   - Activate: → "Approve artist authority first, then link the on-chain
     campaign (escrow + campaign ID)."
   - Confirm booking: → "Enabled once the campaign is funded."
   - Confirm fulfillment: → "Enabled after booking is confirmed."
   - Cancel / Raise dispute: matching one-line unlock conditions.
   Implement as a helper that returns the disabled reason per button, applied
   to the existing `title` attribute (some buttons already have `title` — don't
   clobber the enabled-state title; only set the reason when disabled). Keep it
   accessible: the `title` is fine; if an `aria-describedby` pattern already
   exists in the panel, mirror it, else `title` only.
3. No new controls, no behavior change — copy + tooltips.

Test (`CampaignOperatorPanel.test.tsx`, renderToStaticMarkup): assert the
activation help text renders and that a disabled lifecycle button carries its
reason in `title`. Keep existing tests green.

## #1355 — Fee-era seed fixtures

`backend/src/fixtures/show_campaigns.ts` line ~450: every fixture seeds
`campaignLevel: "active_escrow_campaign"` + `artistAuthorityStatus: "none"` —
an escrow-level label with no escrow link or authority. Fix the dishonesty:

1. **Honest levels (required)**: unlinked fixtures should seed at a level that
   matches their state. Check the `campaignLevel` enum/type — use the
   demand-signal / provisional level (whatever the codebase calls the
   pre-escrow level; grep the type: likely `"signal"` or
   `"provisional_campaign"` — the trust helper in web/src/lib/shows.ts maps
   `provisional_campaign` + authority `none` → "provisional"). Set unlinked
   fixtures to the provisional/signal level so the operator panel and public
   trust badge stop implying a contract link they lack. Update any fixture
   assertion/test that pinned `active_escrow_campaign`.
2. **Optional escrow linking (guarded)**: if the seed process is given
   `SHOW_CAMPAIGN_ESCROW_ADDRESS` (+ per-campaign `contractCampaignId` via env
   or a mapping), link that fixture (set escrowContractAddress +
   contractCampaignId + the authorized level/authority) so hydration can
   populate feeBps. Keep this OFF by default (no env → provisional, honest).
   Only wire this if it's clean to add via the existing seed entrypoint
   (`scripts/deploy/seed-sample-shows.sh` / the fixtures loader) — if it
   balloons scope, ship part 1 only and note part 2 as a follow-up in the PR.
3. **Loop-test fixture (skip)**: the on-chain loop-test campaigns (2 and 3)
   already exist and the smoke (#1392) makes the loop repeatable — do NOT add a
   seeded loop-test fixture; note it as covered by #1392 in the PR.
4. Update `scripts/deploy/seed-sample-shows.sh` docs/comments if part 2 adds
   env passthroughs.

Test: the fixtures file has a self-validation block (grep for the duplicate-slug
check ~line 358); if there's a fixtures integration test
(`show_campaign_fixtures.integration.spec.ts`), update any level assertion.
Verify the fixture loader still runs (the validation function at the bottom).

## Gates

- backend: `npx tsc --noEmit`; run the fixtures spec if present
  (`jest --config jest.integration.config.js --testPathPattern='show_campaign_fixtures'`)
  and `jest shows.controller`.
- web: `npx vitest run src/components/shows src/lib`; eslint changed files.
- `git diff --check` clean.

## Docs

- `docs/features/resonate_shows.md`: note the operator guidance and that sample
  fixtures seed as provisional (honest) until linked.
- Feature catalog / User Guide: no change unless an operator article exists.
