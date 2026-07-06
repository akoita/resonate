# Issue #1392 — Staging lifecycle smoke (Vision Sprint 3 P0)

An automated workflow that walks the full shows money path against the REAL
staging deployment after deploys (and on dispatch/nightly), failing loudly on
any seam break. Converts the Sprint-2 manual UAT into infrastructure.

## Decisions (user-confirmed 2026-07-06)

- **Auth**: dedicated smoke EOA (`0xFd393688e5551B981b24b1Df3683c2c3bDC268A9`,
  key in the `contracts-staging` GitHub environment as
  `SMOKE_WALLET_PRIVATE_KEY`) logs in through the existing
  `POST /auth/nonce` → `POST /auth/verify` wallet-signature flow, requesting
  role `operator`, granted via a new **`OPERATOR_ADDRESSES` allowlist**
  (mirrors `ADMIN_ADDRESSES`; fails closed).
- **Funding**: pre-funded wallet (user tops up test USDC + gas ETH once);
  the smoke asserts balances up front and fails with a clear
  `SMOKE_WALLET_LOW_BALANCE` error under thresholds. Each run pledges
  1 USDC; the release returns 0.94 to the beneficiary (the platform test
  smart account `0xa5369569fd24b019923bae45db8f9c0e6bf482cb`), so net burn
  ≈ 0.06 USDC + gas per run.
- **Credentials layout**: single job in the `contracts-staging` environment —
  it already holds `CONTRACT_DEPLOYER_PRIVATE_KEY` (owner for on-chain
  create/activate/confirm/release) and now the smoke wallet key.

## Staged delivery (three PRs)

### PR A — backend: `OPERATOR_ADDRESSES` allowlist (resonate)

In `backend/src/modules/auth/auth.service.ts`, `ALLOWLISTED_ROLES` gains
`operator: "OPERATOR_ADDRESSES"` (one line — the resolveRole mechanism is
already generic: listed wallet requesting `operator` gets it, everyone else
fails closed to `listener`; `ADMIN_ADDRESSES` still auto-promotes and wins).
Extend the existing auth unit tests covering ALLOWLISTED_ROLES/resolveRole
with: listed wallet + requested operator → operator; unlisted → listener;
listed for operator but requesting admin → listener (no cross-grant). Update
`docs/deployment/environment.md` with the new env var.

### PR B — iac: `OPERATOR_ADDRESSES` env (resonate-iac)

Mirror the `shows_default_payment_token_address` wiring exactly: module
variable `operator_addresses` (string, default "") → backend env
`OPERATOR_ADDRESSES`; environments dev/staging/prod passthrough + .example
entries. Reviewer sets the staging tfvars value to the smoke wallet address
(never print real tfvars) and runs the plan→apply promotion.

### PR C — smoke script + workflow (resonate)

**Script**: `scripts/staging-smoke/lifecycle-smoke.mjs` (Node 20+, deps:
`viem` only — add a small `package.json` in that folder or reuse the repo
root's deps if viem is present at root; keep it standalone-runnable:
`node scripts/staging-smoke/lifecycle-smoke.mjs`).

Env contract (all required unless noted):
`API_BASE` (e.g. https://api-staging.resonate.pydes.xyz), `RPC_URL`,
`SHOW_CAMPAIGN_ESCROW_ADDRESS`, `PAYMENT_TOKEN` (USDC),
`CONTRACT_DEPLOYER_PRIVATE_KEY`, `SMOKE_WALLET_PRIVATE_KEY`,
`SMOKE_BENEFICIARY` (default the platform test smart account),
`MIN_USDC_UNITS` (default 2_000_000), `MIN_GAS_WEI` (default 0.002 ether).

Flow (each step logs a `[smoke] step-name OK (…ms)` line; any failure exits
non-zero with a one-line `SMOKE_FAIL step-name: reason`):

1. **preflight** — RPC chainId matches expected (84532 on staging), smoke
   wallet USDC/gas balances above thresholds (`SMOKE_WALLET_LOW_BALANCE`
   error naming the address and faucet URL if not), API `/health` OK.
2. **auth** — nonce+verify as the smoke EOA with role `operator`; assert the
   JWT decodes with role operator (base64 payload check, no secret needed).
3. **chain-create** — with the deployer key (viem walletClient):
   `createCampaign` on the escrow (goal 1_000_000 units, minBackers 1,
   deadline now+30min, bookingDeadline now+60min, depositReleaseBps 0,
   disputeWindowSeconds 60, artistIdHash/authorityHash keccak of
   `smoke:<runId>` strings, beneficiary SMOKE_BENEFICIARY, token
   PAYMENT_TOKEN) + `activateCampaign`. Capture campaignId from the
   CampaignCreated log.
4. **api-draft** — as operator: create a draft campaign via the API with
   MATCHING terms (goal/deadlines/minBackers/token; title
   `Smoke <runId> — lifecycle test`, city `Smoke`, a clearly-test pitch).
   Discover the exact request shape from `shows.controller.ts` /
   `shows.service.ts` (`createDraftCampaign` input) — the smoke user may need
   an artist: use whatever the API requires; if a catalog artist credit is
   mandatory, create the draft with the smoke operator's own artist profile
   path used by tests, or the operator-permitted variant — mirror what
   `shows.service.integration.spec.ts` does for campaign creation and what
   the create form submits.
5. **api-authority + activate** — approve authority (operator route), then
   activate with `SHOW_CAMPAIGN_ESCROW_ADDRESS` + the captured campaignId.
   Assert the activation response: `feeBps` = on-chain fee, `onChainStatus`
   Active, `paymentTokenAddress` = PAYMENT_TOKEN (the #1364/#1391
   regressions), and that every API response so far parsed as JSON (the
   #1386 regression is implicitly covered by parsing).
6. **pledge** — `createPledgeIntent` via API as the smoke user (its wallet is
   the smoke EOA — register/bind the wallet the way the app does if the
   intent route requires `walletAddress` bound to the caller: inspect
   `createPledgeIntent`'s #1221 wallet-binding rule and satisfy it, e.g. via
   the wallet record created at signup/verify). Then on-chain from the smoke
   EOA: ERC-20 `approve(escrow, 1_000_000)` + `pledge(campaignId, 1_000_000)`.
7. **indexer-confirm** — poll the API (max ~3min) until the campaign is
   `funded`/`Funded` and the pledge receipt is confirmed (mirrors what the
   UI shows). This proves the indexer leg.
8. **confirm + fulfill** — deployer key: `confirmBooking`, `confirmFulfillment`.
9. **release** — wait out the 60s dispute window (+buffer), `releaseFunds`;
   assert on-chain `campaignFees(id)` totalFeePaid = 60_000 (6% of 1 USDC)
   and beneficiary/feeRecipient USDC deltas.
10. **backend-settled** — poll until API shows `status released`,
    breakdown `totalFeePaidUnits "60000"`, `grossReleasedUnits "1000000"`,
    `netReleasedToArtistUnits "940000"`.
11. **report** — print a summary table (step timings, tx hashes, fee split);
    on any failure, the workflow step summary carries `SMOKE_FAIL`.

**Workflow**: `.github/workflows/staging-lifecycle-smoke.yml` —
`workflow_dispatch` + `schedule` (nightly 05:00 UTC). Single job,
`environment: contracts-staging`, checkout, setup-node (hardened npm action
like other workflows if it fits, else plain setup-node + `npm ci` scoped to
the script folder), run the script with env from vars/secrets
(`API_BASE` from a new `STAGING_API_BASE` env var — add to contracts-staging
vars, value https://api-staging.resonate.pydes.xyz; `RPC_URL` from existing
staging RPC var if present, else add `STAGING_RPC_URL`), and a failure step
that creates-or-comments a `smoke-failure`-labeled issue via `gh` (title
"Staging lifecycle smoke failed", body linking the run; reuse an open one if
it exists). A post-deploy trigger from resonate-iac is a follow-up — note it
in the issue when finishing, don't build it in this PR.

**Docs**: new `docs/features/staging_lifecycle_smoke.md` feature page
(status implemented; who it's for = operators/CI; how to run/dispatch/read
failures; env contract; wallet top-up runbook incl. the faucet URL and the
smoke wallet address) + feature catalog row + a pointer from
`docs/smart-contracts/operations-runbook.md`. No user-guide change (not a
user-facing surface).

## Sequencing / gates

- PR A first (tiny, unblocks config), PR B second (then tfvars+apply), PR C
  last; first dispatch of the workflow validates end to end after the user
  funds the wallet.
- PR A gates: backend unit tests (auth specs) green.
- PR C gates: `node --check` the script; workflow YAML parses; the script
  supports a `--dry-run` flag that stops after preflight+auth (used in PR
  validation against staging without burning a campaign... only if trivially
  done — otherwise skip dry-run).
- The smoke's campaigns are named `Smoke …` and end `released` (excluded
  from public discovery by the #1357 filter). No fixture pollution.

## Operator input (user)

Fund `0xFd393688e5551B981b24b1Df3683c2c3bDC268A9` on Base Sepolia:
~20 test USDC (faucet.circle.com) + ~0.05 ETH gas (any Base Sepolia faucet).
