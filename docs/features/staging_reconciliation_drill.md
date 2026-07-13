# Staging Reconciliation Drill

**Status:** implemented
**Audience:** operators, CI/on-call
**Revenue line:** vision-neutral (infra/quality — protects revenue line 1, Shows
campaign fees, by proving the reconciliation-mismatch safety net actually fires)

## What it is

An automated workflow that **provokes a genuine on-chain drift against the real
staging deployment and asserts the escrow indexer detects it**. Where the
[lifecycle smoke](staging_lifecycle_smoke.md) proves the happy money path, this
drill proves the **safety net** — the `shows.campaign_reconciliation_mismatch`
alert (#1271) — is real end to end, not just wired in code. It is the last
implementation gap in the #1271 production go-live gate.

The drift is deliberate: the drill **binds a campaign in the backend** (draft +
authority + activate/link) and then **pledges on-chain WITHOUT creating the
backend pledge intent**. The indexer sees a `Pledged` event on a bound campaign
with no matching intent, which is exactly the "on-chain pledge … has no matching
backend intent" reconciliation drift. That drift fans out three ways
(`ShowsEscrowIndexerService.emitMismatch`):

1. a **structured app-event log line** (`jsonPayload.event =
   "shows.campaign_reconciliation_mismatch"`, `service = "resonate-backend"`) —
   the surface the `resonate-iac` log-based metric parses into a Cloud
   Monitoring **email alert**;
2. a **durable analytics fact** via the domain-event bridge;
3. the operator read endpoint `GET /shows/operator/reconciliation-mismatches`.

The drill asserts (3), which is only populated by (2) and driven by the same
detection as (1).

Each run:

1. **preflight** — RPC chain id (84532), smoke-wallet USDC + gas thresholds
   (else `SMOKE_WALLET_LOW_BALANCE`), and API `/health`.
2. **auth** — logs the smoke EOA in via `POST /auth/nonce` → `POST /auth/verify`
   as `operator` and asserts the JWT role (needs the wallet in
   `OPERATOR_ADDRESSES`).
3. **chain-create** — deployer key: `createCampaign` + `activateCampaign`.
4. **api-bind** — creates the matching draft, approves authority, and activates
   against the on-chain campaign so the backend row is **bound** (with the same
   resync-hydration polling as the smoke). Binding is what makes the drift the
   pledge-without-intent variety rather than "no bound campaign".
5. **drift-pledge** — smoke wallet: on-chain `approve` + `pledge`, **skipping the
   `/pledges/intent` API call**. This is the provoked drift. The pledge txHash is
   recorded.
6. **assert-detection** (the PASS condition) — polls
   `GET /shows/operator/reconciliation-mismatches?contractCampaignId=<id>`
   (operator JWT, bounded ~4 min) until an entry appears whose `transactionHash`
   is our pledge tx **and** whose `reason` contains `no matching backend intent`.
7. **cleanup** — deployer `cancelCampaign` (Funded is cancellable) → smoke
   `claimRefund` → asserts the smoke wallet's USDC is **fully restored** (delta 0,
   only gas burns) → polls the API campaign to a discovery-excluded refund state.
   Self-cleaning, like the smoke's `auto` mode.
8. **alert reminder** — prints a reminder that the Cloud Monitoring email alert
   on `backend_app_events{event="shows.campaign_reconciliation_mismatch"}` should
   have fired. The workflow **cannot** assert email delivery, so an operator
   running the drill confirms the notification arrived out of band.

Every step logs `[drill] <step> OK (<ms>)`; any failure exits non-zero with a
one-line `SMOKE_FAIL <step>: <reason>`, and the workflow opens/updates a
`smoke-failure` issue titled **"Staging reconciliation drill failed"**.

## Why `workflow_dispatch` only (no schedule)

Each run burns a campaign and relies on indexer timing. Unlike the smoke, there
is no nightly value in re-proving detection continuously; the drill is run
**deliberately** — after a deploy that touches the escrow indexer, and to
produce the #1271 gate proof. It shares the smoke's script helpers
(`scripts/staging-smoke/lib.mjs`), env contract, and `contracts-staging`
environment.

## Who it is for

- **Operators / on-call** — the one-click proof that a real on-chain drift is
  detected and surfaced; run it after indexer changes.
- **The #1271 go-live gate** — the artifact that closes "make the mismatch alert
  real".

## How to run

### Dispatch manually

1. GitHub → **Actions → Staging Reconciliation Drill → Run workflow**.
2. Optional input `dry_run` — stop after preflight + auth (no campaign burned);
   validates config/secrets without spending USDC.
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
node reconciliation-drill.mjs            # add --dry-run to stop after auth
```

## PASS / FAIL semantics

- **PASS** — the operator endpoint returns a mismatch row with our pledge txHash
  and a `no matching backend intent` reason within `MISMATCH_TIMEOUT_MS`
  (default 4 min), then cleanup restores the USDC and settles the campaign to a
  discovery-excluded state. Exit 0.
- **FAIL** — any `SMOKE_FAIL <step>: <reason>`. The most important one:
  - `SMOKE_FAIL assert-detection: no reconciliation mismatch for pledge …` →
    the indexer alert did **not** fire (indexer down/lagging past the bound, the
    analytics bridge not writing the fact, or the operator endpoint broken).
    This is the gate-blocking failure; follow the
    [operations runbook](../smart-contracts/operations-runbook.md).
  - `SMOKE_FAIL api-bind: onChainStatus is "Draft" …` → hydration is persistently
    wrong (same diagnosis as the smoke).
  - `SMOKE_FAIL cleanup-refund: smoke wallet USDC … != pre-run balance …` → the
    detection passed but cleanup left USDC stranded; reconcile manually.

## Cleanup behavior

The provoked campaign always ends cleaned up: `cancelCampaign` →
`claimRefund` → USDC fully restored (delta 0) → API campaign in
`refund_available` / `cancelled` / `refunded` (all discovery-excluded, #1357).
If the drill fails **before** cleanup (e.g. `assert-detection` times out), the
campaign is left `Funded` with the smoke wallet's 1 USDC in escrow — clean it up
with the same `cast send … cancelCampaign` + `claimRefund` pair the smoke's
`skip`-mode log documents.

## Environment contract

Identical to the [lifecycle smoke](staging_lifecycle_smoke.md#environment-contract),
read from the `contracts-staging` environment. Drill-specific optional tuning:

| Variable | Required | Notes |
| --- | --- | --- |
| `MISMATCH_TIMEOUT_MS` | no | Detection-polling bound (default `240000`, 4 min) |
| `MISMATCH_LOOKBACK_MINUTES` | no | Window queried on the operator endpoint (default `60`) |
| `REFUND_TIMEOUT_MS` | no | Cleanup refund-state polling bound (default `180000`) |

No new **backend** or deploy env vars are introduced by this drill.

## References

- Script: `scripts/staging-smoke/reconciliation-drill.mjs`
- Shared helpers: `scripts/staging-smoke/lib.mjs` (also used by the smoke)
- Workflow: `.github/workflows/staging-reconciliation-drill.yml` (`workflow_dispatch` only)
- Indexer + alert emission: `backend/src/modules/shows/shows-escrow-indexer.service.ts`
  (`emitMismatch`), structured helper `backend/src/modules/shared/structured_logging.ts`
- Operator endpoint: `GET /shows/operator/reconciliation-mismatches`
  (`ShowsController.listReconciliationMismatches` → `ShowsService.listReconciliationMismatches`)
- Analytics bridge entry: `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`
- iac alert policy + log-based metric: `resonate-iac` `modules/observability/main.tf`
  (`shows.campaign_reconciliation_mismatch`)
- Companion: [Staging Lifecycle Smoke](staging_lifecycle_smoke.md)
- Feature page: [Resonate Shows](resonate_shows.md)
- Operations pointer: [operations runbook](../smart-contracts/operations-runbook.md)
- Issue: [#1271](https://github.com/akoita/resonate/issues/1271)
