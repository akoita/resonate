# Staging Lifecycle Smoke

**Status:** implemented
**Audience:** operators, CI/on-call
**Revenue line:** vision-neutral (infra/quality — protects revenue line 1, Shows
campaign fees, by catching money-path regressions before real users hit them)

## What it is

An automated workflow that walks the **full Shows money path against the real
staging deployment** and fails loudly on any seam break. It converts the
Sprint-2 manual UAT into infrastructure so a regression in JSON serialization
(#1386), payment-token chain-truth (#1364/#1391), fee hydration, or the escrow
indexer is caught by CI instead of by a fan.

Each run:

1. **preflight** — asserts the RPC chain id (84532), that the smoke wallet holds
   enough test USDC + gas (else `SMOKE_WALLET_LOW_BALANCE`), and that the API
   `/health` responds.
2. **auth** — logs the smoke EOA in through `POST /auth/nonce` →
   `POST /auth/verify` requesting role `operator`, and asserts the JWT decodes
   with `role: operator` (needs the wallet in `OPERATOR_ADDRESSES`).
3. **chain-create** — with the deployer key: `createCampaign` + `activateCampaign`
   on the escrow, capturing the campaign id from the `CampaignCreated` event.
4. **api-draft** — creates a matching draft campaign via the API as the operator.
5. **api-authority + activate** — approves authority, activates against the
   on-chain campaign, and asserts the hydration response: `paymentTokenAddress`
   equals the configured token, `onChainStatus` is `Active`, `feeBps` equals the
   on-chain fee (600). Every API response is parsed as JSON (covers #1386).
   Because the backend hydrates from its own RPC replica (which can lag behind
   the replica that confirmed our tx — observed 2026-07-11, #1399), stale
   hydration triggers up to 5 `POST …/resync-chain` polls (4s apart) before
   failing — which also gives the #1364 resync correction path nightly
   coverage.
6. **pledge** — creates a pledge intent as the smoke user (its wallet row was
   bound at `/auth/verify`, satisfying the #1221 rule), then on-chain `approve` +
   `pledge` from the smoke EOA.
7. **indexer-confirm** — polls the public campaign (bounded ~3 min) until it is
   `Funded` with the raised amount reflected. This proves the indexer leg.

Then the run finishes on one of two terminal legs, selected by `RELEASE_MODE`:

**Refund leg (`auto`, the nightly default — fast, self-cleaning, ~0 USDC net):**

8. **cancel** — deployer key: `cancelCampaign` (Funded is cancellable), and
   asserts the on-chain status flips to `RefundAvailable`.
9. **claim-refund** — smoke wallet: `claimRefund`, then asserts the refund is
   fee-free: on-chain `totalRefunded` equals the pledge (1,000,000 units) and
   the smoke wallet's USDC balance is **fully restored** to its pre-run value
   (delta 0 — only gas, paid in ETH, burns). With one backer the claim also
   settles the on-chain campaign to `Refunded`.
10. **backend-refund-state** — polls (bounded ~3 min) until the API campaign
    reaches `refund_available` / `cancelled` / `refunded`. All three are
    excluded from public discovery (#1357), so no test campaign lingers.

**Release leg (`full`, the weekly schedule — proves the fee path):**

8. **confirm + fulfill** — deployer key: `confirmBooking`, `confirmFulfillment`.
9. **release** — waits out the dispute window (contract minimum 1 hour),
   `releaseFunds`, and asserts the on-chain `totalFeePaid` = 6% of the pledge
   (60,000 units for 1 USDC) plus the beneficiary / fee-recipient balance deltas.
10. **backend-settled** — polls (bounded ~2 min) until the API shows
    `status: released` with `campaignFeeBreakdown` of
    `totalFeePaidUnits "60000"`, `grossReleasedUnits "1000000"`,
    `netReleasedToArtistUnits "940000"`.

Finally:

11. **report** — prints a summary table (mode, step timings, tx hashes, fee split).

Every step logs `[smoke] <step> OK (<ms>)`; any failure exits non-zero with a
one-line `SMOKE_FAIL <step>: <reason>`, and the workflow opens/updates a
`smoke-failure` issue.

### The two modes (and why)

The deployed escrow enforces `MIN_DISPUTE_WINDOW = 1 hour`, so `releaseFunds`
cannot run inside a fast smoke. Leaving the campaign at `Fulfilled` would strand
the smoke wallet's pledge in escrow **and** leave a visible test campaign in
public discovery (`Fulfilled` is not in the #1357 excluded-status list). Hence:

| Mode | Behavior |
| --- | --- |
| `auto` (default, nightly `0 5 * * *`) | After the pledge is indexed, cancel + claim the refund. Tests the refund seam end to end, recycles the wallet's USDC (only gas burns), and ends in a discovery-excluded state — fully self-cleaning, well under 15 min. |
| `full` (weekly `0 4 * * 0`, or dispatch) | Booking → fulfillment → wait the real 1-hour dispute window → release → fee assertions → backend `released`. This is the fee-leg coverage; runtime >1 h (workflow `timeout-minutes: 90`). Burns ≈0.06 USDC (the fee) per run. |
| `skip` | Stops after the indexer leg and **warns**: the campaign is left `Funded` (publicly visible, pledge stranded) and the log prints the exact cleanup commands — the `cast send … cancelCampaign/claimRefund` pair, or the ops-console `confirm-show-campaign-booking` → `confirm-show-campaign-fulfillment` → `release-show-campaign-funds` dispatches with the campaign id. |

## Who it is for

- **Operators / on-call** — the nightly (refund-loop) and weekly (fee-leg)
  signals that staging's money path is intact; the failure issue is the entry
  point.
- **CI** — post-deploy confidence (a post-deploy trigger from `resonate-iac` is
  a tracked follow-up, not wired in this PR).

## How to run

### Dispatch manually

1. GitHub → **Actions → Staging Lifecycle Smoke → Run workflow**.
2. Optional inputs:
   - `dry_run` — stop after preflight + auth (no campaign burned); good for
     validating config/secrets without spending USDC.
   - `release_mode` — `auto` / `full` / `skip` (see the table above).
3. The job runs in the `contracts-staging` environment.

### Run locally

```bash
cd scripts/staging-smoke
npm ci
API_BASE=https://api-staging.resonate.pydes.xyz \
RPC_URL=<base-sepolia-rpc> \
SHOW_CAMPAIGN_ESCROW_ADDRESS=0xd7035cf620c09653542b75a9b95bbec1514d8b23 \
PAYMENT_TOKEN=<usdc-address> \
CONTRACT_DEPLOYER_PRIVATE_KEY=<owner-key> \
SMOKE_WALLET_PRIVATE_KEY=<smoke-key> \
node lifecycle-smoke.mjs            # add --dry-run to stop after auth
```

## Reading failures

- The workflow opens (or comments on the existing open) issue titled
  **"Staging lifecycle smoke failed"** labeled `smoke-failure`, linking the run.
- Open the run's `Run lifecycle smoke` step and find the
  `SMOKE_FAIL <step>: <reason>` line — it names the failing step and the reason.
- Common cases:
  - `SMOKE_FAIL preflight: SMOKE_WALLET_LOW_BALANCE …` → top up the wallet (below).
  - `SMOKE_FAIL auth: JWT role is "listener"…` → the smoke wallet is not in
    `OPERATOR_ADDRESSES` in the staging backend config.
  - `SMOKE_FAIL api-authority: paymentTokenAddress is …` → a #1364/#1391-class
    chain-truth regression.
  - `SMOKE_FAIL api-authority: onChainStatus is "Draft" … (after 5 resync
    attempts — not replica lag)` → hydration is persistently wrong, not lagging:
    check the backend RPC endpoint health and the escrow read path.
  - `SMOKE_FAIL indexer-confirm: campaign not funded within …` → the escrow
    indexer is not confirming pledges.
  - `SMOKE_FAIL claim-refund: smoke wallet USDC … != pre-run balance …` → the
    refund seam returned the wrong amount (accounting regression).
  - `SMOKE_FAIL backend-refund-state: campaign not in a refund state within …`
    → the indexer is not reconciling cancel/refund events.
  - `SMOKE_FAIL api-draft: … must select a catalog artist …` → staging has no
    catalog artist matching `SMOKE_ARTIST_DISPLAY_NAME`; set
    `SMOKE_ARTIST_DISPLAY_NAME` (or `SMOKE_ARTIST_ID`) to an artist with at least
    one ready/published release.

## Environment contract

Read in the `contracts-staging` GitHub environment (`vars` / `secrets`) or from
the shell locally.

| Variable | Source | Required | Notes |
| --- | --- | --- | --- |
| `API_BASE` | var `STAGING_API_BASE` | yes | e.g. `https://api-staging.resonate.pydes.xyz` |
| `RPC_URL` | secret/var `BASE_SEPOLIA_RPC_URL` (fallback `https://sepolia.base.org`) | yes | Base Sepolia JSON-RPC |
| `SHOW_CAMPAIGN_ESCROW_ADDRESS` | var | yes | Deployed escrow |
| `PAYMENT_TOKEN` | var | yes | USDC (6 decimals) |
| `CONTRACT_DEPLOYER_PRIVATE_KEY` | secret | yes | Escrow owner (create/activate/confirm/release) |
| `SMOKE_WALLET_PRIVATE_KEY` | secret | yes | Pre-funded EOA that pledges + authenticates |
| `SMOKE_BENEFICIARY` | var | no | Default `0xa5369569fd24b019923bae45db8f9c0e6bf482cb` (platform test smart account) |
| `SMOKE_ARTIST_DISPLAY_NAME` | var | no | Catalog artist the draft credits (default `Smoke Test Artist`) |
| `SMOKE_ARTIST_ID` | var | no | Explicit catalog `artistId` (skips display-name lookup) |
| `RELEASE_MODE` | input/schedule | no | `auto` (default; weekly cron `0 4 * * 0` runs `full`) — see the modes table |
| `EXPECTED_CHAIN_ID` | var | no | Default `84532` |
| `GOAL_UNITS` / `PLEDGE_UNITS` | var | no | Default `1000000` (1 USDC) |
| `EXPECTED_FEE_BPS` | var | no | Default `600` |
| `DISPUTE_WINDOW_SECONDS` | var | no | Default `3600` (contract `MIN_DISPUTE_WINDOW`) |
| `MIN_USDC_UNITS` / `MIN_GAS_WEI` | var | no | Preflight thresholds |
| `INDEXER_TIMEOUT_MS` / `SETTLED_TIMEOUT_MS` / `REFUND_TIMEOUT_MS` | var | no | Bounded polling waits |

## Smoke wallet top-up runbook

The smoke wallet is a dedicated EOA:

```
0xFd393688e5551B981b24b1Df3683c2c3bDC268A9
```

Nightly `auto` runs pledge 1 USDC and claim it back fee-free — net USDC cost
≈ 0, only gas burns. Weekly `full` runs release through the fee path: 1 USDC
leaves the wallet (0.94 to the beneficiary, 0.06 fee), so the steady-state burn
is ≈ 1 USDC + gas per week.

1. **Test USDC** — mint on Base Sepolia at the **Circle faucet**:
   <https://faucet.circle.com>. Target ~20 USDC so the wallet stays above the
   `MIN_USDC_UNITS` preflight threshold across months of weekly full runs.
2. **Gas ETH** — fund ~0.05 Base Sepolia ETH from any Base Sepolia faucet.
3. Re-run the workflow with `dry_run=true` to confirm the balances clear
   preflight without burning a campaign.

If preflight fails with `SMOKE_WALLET_LOW_BALANCE`, the error names the address
and the faucet URL.

## References

- Implementation plan: `docs/issue-1392-implementation-plan.md`
- Script: `scripts/staging-smoke/lifecycle-smoke.mjs`
- Workflow: `.github/workflows/staging-lifecycle-smoke.yml`
- Escrow contract: `contracts/src/core/ShowCampaignEscrow.sol`,
  interface `contracts/src/interfaces/IShowCampaignEscrow.sol`
- Operator role allowlist: `OPERATOR_ADDRESSES` in
  `docs/deployment/environment.md`
- Operations pointer: `docs/smart-contracts/operations-runbook.md`
- Issue: [#1392](https://github.com/akoita/resonate/issues/1392)
