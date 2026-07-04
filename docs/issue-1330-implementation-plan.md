# Issue #1330 — 6% success-only campaign fee in `ShowCampaignEscrow`

> Plan author: Fable (high-level design + review). Implementation delegated to
> Codex CLI per the Fable-plans/Codex-implements working mode.
> Decision basis: ADR-BM-1 (accepted 2026-07-04) — 6% platform fee,
> success-only, deducted at release time, refunds always 100% fee-free.
> Canonical record: `docs/rfc/business-model.md` (Layer 4).

## Design decisions (settled — do not re-litigate in implementation)

1. **Per-campaign fee snapshot.** The contract holds a default
   `campaignFeeBps` + `feeRecipient` (constructor args, owner-updatable for
   *future* campaigns via one setter). `createCampaign` snapshots the current
   default into the `Campaign` struct. **A campaign's fee never changes after
   creation** — pledgers commit against fixed terms.
2. **Fee on release paths only.** Fee is charged in `releaseDeposit` and
   `releaseFunds`, never in `claimRefund`. Refund math is untouched.
3. **Gross accounting, net transfer.**
   - In both release paths: `gross` = existing computed amount;
     `fee = gross * feeBps / BPS_DENOMINATOR` (floor);
     `net = gross - fee`.
   - `campaign.totalReleased += gross` (UNCHANGED semantics — this keeps the
     existing pro-rata refund math and conservation invariant definitions
     valid with zero changes to `claimRefund`/`refundable`).
   - New accumulator `campaign.totalFeePaid += fee`.
   - Transfer `net` to `beneficiary`, `fee` to `feeRecipient`.
4. **Events.** Beneficiary-facing events (`DepositReleased`, `FundsReleased`)
   now emit the **net** amount actually received by the beneficiary. A new
   `FeeCharged(uint256 indexed campaignId, address indexed feeRecipient, uint256 amount)`
   is emitted alongside whenever `fee > 0`. Gross is derivable (net + fee).
5. **Hard cap.** `uint256 public constant MAX_CAMPAIGN_FEE_BPS = 1000;`
   (10%). Deploy config sets 600 (6%). `feeBps == 0` is legal (fee-free mode):
   skip fee transfer and `FeeCharged`.
6. **Validation.** Constructor and setter: `feeBps > MAX_CAMPAIGN_FEE_BPS` →
   new error `InvalidFeeBps(uint256 requested, uint256 max)`;
   `feeRecipient == address(0)` while `feeBps > 0` → `ZeroAddress()`.
   `feeRecipient` may not be the escrow itself.
7. **Struct layout.** Append `feeBps` and `totalFeePaid` at the END of the
   `Campaign` struct so the existing public-getter tuple prefix stays stable.
8. **New views.** `campaignFees(uint256 campaignId) returns (uint256 feeBps, uint256 totalFeePaid)`.
   Existing views keep their signatures.

## Stage A — contracts + full test ladder (delegate first, gate before Stage B)

### Files

- `contracts/src/interfaces/IShowCampaignEscrow.sol`
  - `Campaign` struct: append `uint256 feeBps; uint256 totalFeePaid;`
  - New event `FeeCharged(uint256 indexed campaignId, address indexed feeRecipient, uint256 amount)`.
  - New event `FeeConfigUpdated(uint256 feeBps, address feeRecipient)`.
  - New error `InvalidFeeBps(uint256 requested, uint256 max)`.
- `contracts/src/core/ShowCampaignEscrow.sol`
  - Constructor → `constructor(address _owner, uint256 _feeBps, address _feeRecipient)`,
    validated per decisions 5–6; emit `FeeConfigUpdated`.
  - `setFeeConfig(uint256 feeBps, address feeRecipient) external onlyOwner`
    (validated; affects future campaigns only; emit `FeeConfigUpdated`).
  - `createCampaign`: snapshot `feeBps: campaignFeeBps` into the struct
    (`totalFeePaid: 0`).
  - `releaseDeposit` / `releaseFunds`: apply decision 3–4. Keep CEI order and
    `nonReentrant` exactly as today (effects before transfers; two
    `safeTransfer`s at the end: beneficiary then feeRecipient).
  - `campaignFees` view.
- Deploy script (find the existing `ShowCampaignEscrow` deploy script under
  `contracts/script/` and follow its conventions, incl. `DeploymentKey.s.sol`):
  - env vars `SHOW_CAMPAIGN_FEE_BPS` (default `600`) and
    `SHOW_CAMPAIGN_FEE_RECIPIENT` (required on remote envs; local/Anvil may
    default to the owner address);
  - deployment record + `.remote.env` handoff must include both values
    (follow `contracts/deployments/` conventions per CLAUDE.md).
- ABI handoffs: regenerate whatever generated ABI modules exist for this
  contract (search for how `web/src/contracts_abi` and backend ABI modules are
  produced — follow the existing mechanism, do not invent a new one).

### Tests (extend the existing four suites; import errors/events from the interface)

- `contracts/test/unit/ShowCampaignEscrow.t.sol`
  - fee charged on `releaseFunds`: exact net/fee amounts for a known pledge
    set at 600 bps; `FeeCharged` + `FundsReleased(net)` emitted; beneficiary
    and feeRecipient balances exact; `totalFeePaid` recorded; status
    `Released`.
  - fee charged on `releaseDeposit` (same assertions; then final
    `releaseFunds` fee applies to the remaining gross only — no double fee).
  - refunds are fee-free: failed campaign → every backer gets exactly their
    pledge back regardless of feeBps.
  - cancelled-after-deposit: refunds share `totalPledged - totalReleased`
    (gross) pro-rata — unchanged behavior; fee kept only on the released part.
  - snapshot: `setFeeConfig` after creation does not change an existing
    campaign's fee; new campaigns pick up the new default.
  - validation: constructor + `setFeeConfig` revert on `feeBps > 1000`
    (`InvalidFeeBps`) and on zero recipient with non-zero fee (`ZeroAddress`);
    `setFeeConfig` is `onlyOwner`.
  - zero-fee mode: no `FeeCharged`, beneficiary receives gross.
  - Update every existing test that constructs the escrow to the new
    constructor signature (use 0 fee where the test's subject is unrelated to
    fees, so existing expected values stay valid; add fee-bearing variants
    only in the new tests).
- `contracts/test/fuzz/ShowCampaignEscrow.fuzz.t.sol`
  - property: for fuzzed pledges and `feeBps ≤ 1000`:
    `fee == gross * feeBps / 10_000`, `net + fee == gross`, and
    `beneficiaryDelta + feeRecipientDelta + Σ refunds ≤ totalPledged`.
  - property: refund amount for any backer is independent of `feeBps` when
    nothing was released.
- `contracts/test/invariant/ShowCampaignEscrow.invariant.t.sol`
  - keep existing conservation invariant (it must still hold verbatim since
    `totalReleased` stays gross):
    `token.balanceOf(escrow) == Σ(totalPledged − totalRefunded − totalReleased)`.
  - add: `feeRecipient` cumulative received `== Σ totalFeePaid` (track via
    handler ghost variable).
  - add: `beneficiary` cumulative received `== Σ(totalReleased − totalFeePaid)`.
  - add: per campaign `totalFeePaid ≤ totalReleased * feeBps / 10_000 + 1 wei`
    slack for rounding (or exact if the handler tracks per-release grosses).
  - handler: give the fee config non-trivial values (e.g., 600 bps) and
    include `setFeeConfig` calls in the handler action set to exercise the
    snapshot guarantee.
- `contracts/test/formal/ShowCampaignEscrow.formal.t.sol`
  - follow the existing `check_*` style: add a symbolic check that for any
    reachable release, `net + fee == gross` and refund paths never reference
    `feeBps`. If Halmos is not runnable locally, still write the checks
    (CI runs them — the formal workflow is a required check).

### Stage A gates (must pass before Stage B)

```bash
cd contracts && forge build && forge fmt --check && forge test
```

All suites green, including every pre-existing test (updated constructor
call-sites only — no weakened assertions).

## Stage B — backend indexer + API

- Prisma: add `feeBps Int?` and `totalFeePaid` (string/decimal, follow the
  existing money-column convention in `ShowCampaign`) + migration +
  `npx prisma generate`.
- `backend/src/modules/contracts/indexer.service.ts`: parse `FeeCharged` and
  `FeeConfigUpdated`; persist per-campaign `totalFeePaid`; keep
  `DepositReleased`/`FundsReleased` handlers correct under net-amount
  semantics (they now carry net — if existing code treats them as gross,
  reconcile: gross = event amount + FeeCharged amount in the same tx).
- `backend/src/modules/shows/shows.service.ts` + controller: campaign detail
  API exposes `feeBps`, `totalFeePaid`, and an honest client-ready breakdown
  (estimated fee + net-to-artist at goal).
- Reconciliation (`ENABLE_SHOWS_ESCROW_INDEXER` path): include fee fields so
  `shows.campaign_reconciliation_mismatch` doesn't false-positive on net
  amounts.
- Tests: extend the existing shows integration/controller specs
  (`backend/src/tests/`, Testcontainers conventions — never mock Prisma).
- Analytics: emit/extend the campaign settlement event with fee fields per
  the analytics event conventions (check `analytics_event.ts` taxonomy).

### Stage B gates

Focused Jest suites for shows + indexer green
(`npx jest --runInBand --config jest.integration.config.js --testPathPattern='shows|indexer'`
or the repo's equivalent), `npm run lint` in `backend/`.

## Stage C — web + user guide

- Campaign detail page + pledge flow: display the fee honestly, e.g.
  "A 6% platform fee applies only if the campaign is funded — deducted from
  the artist payout at release. If the campaign fails, you are refunded 100%."
  Derive the percentage from the API `feeBps` (never hardcode 6%).
- Artist-facing campaign management: show net-to-artist estimate.
- User guide (`web/src/lib/help/content.ts`): update the Shows article with
  the fee explanation (plain language); keep
  `cd web && npx vitest run src/lib/help` green.
- Tests/lint: focused Vitest + `npm run lint` in `web/`.

## Out of scope (this issue)

- Production deploy / address promotion (#1271 gate).
- Marketplace take-rate ADR-BM-2 (#1333).
- Any fee on refunds (red line) or retroactive fee changes (snapshot design).

## Review protocol

Codex implements per stage; Fable reviews each stage's diff, runs the gates,
and iterates before the next stage. Codex must NOT run `git commit`/`git push`
— commits are made by the reviewer after each stage passes.
