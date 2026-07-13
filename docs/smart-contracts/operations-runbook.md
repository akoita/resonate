# Contract Operations Runbook

This is the cold-start guide for the manual **Smart Contract Deployment**
workflow in `.github/workflows/contracts-deploy.yml`. It is written for an
operator who has not touched contract ops in months.

## Before You Click Run

Use GitHub Actions in this repository:

1. Open **Actions -> Smart Contract Deployment**.
2. Select `environment=dev` or `environment=staging`.
3. Select `target_network=base-sepolia` unless the operation explicitly targets
   Sepolia.
4. Run `operation=preflight` first.
5. Run the narrowest operation that matches the change.

The workflow maps `environment=staging` to the protected GitHub environment
`contracts-staging` and `environment=dev` to `contracts-dev`.

Common workflow inputs:

| Input | Use |
| --- | --- |
| `environment` | Selects `contracts-dev` or `contracts-staging`; this is where secrets and variables are read. |
| `target_network` | Selects `base-sepolia` or `sepolia`; normal staging ops use `base-sepolia`. |
| `operation` | Selects the deploy, config, create, or verify action. |
| `campaign_id` | Campaign id for Shows lifecycle operations. Leave empty for non-lifecycle operations. |
| `verify_contracts` | BaseScan/Etherscan mode for Base Sepolia deploys: `auto`, `true`, or `false`. |

Core GitHub environment secrets:

| Secret | Used by |
| --- | --- |
| `CONTRACT_DEPLOYER_PRIVATE_KEY` | Preferred signer for preflight, deploy, upgrade, and admin/config ops. The signer must be the relevant contract owner for owner-only calls. |
| `PRIVATE_KEY` | Legacy fallback for `CONTRACT_DEPLOYER_PRIVATE_KEY`. |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC; may also be a variable if the URL is public. |
| `SEPOLIA_RPC_URL` | Sepolia RPC; may also be a variable if the URL is public. |
| `ETHERSCAN_API_KEY` | BaseScan/Etherscan verification key used by CI verify flows. |
| `BASESCAN_API_KEY` | Backward-compatible verification key alias. Prefer `ETHERSCAN_API_KEY`. |

Core GitHub environment variables:

| Variable | Used by |
| --- | --- |
| `BROADCAST_FILE` | Optional verification broadcast override. |
| `VERIFY_ONLY` | Optional contract-name filter for verification scripts. |
| `VERIFY_RETRIES`, `VERIFY_DELAY_SECONDS` | BaseScan/Etherscan retry tuning. |
| `SOURCIFY_API_URL`, `SOURCIFY_RETRIES`, `SOURCIFY_DELAY_SECONDS` | Sourcify endpoint and retry tuning. |
| `BASESCAN_API_URL` | BaseScan/Etherscan API override. |

## Operation Matrix

| Operation | When to use | Inputs and environment | Outputs | Follow-through |
| --- | --- | --- | --- | --- |
| `preflight` | Always run before a write operation after changing env vars, RPCs, or signer keys. | Workflow: `environment`, `target_network`, `operation=preflight`. Secrets: deployer key and target RPC. | Step summary with chain ID, signer address, ETH balance, and selected operation. | If signer, chain ID, or balance is wrong, fix the GitHub environment before running a write op. |
| `deploy-protocol` | Fresh full protocol graph deployment when constructor immutables or tightly coupled addresses change. | Workflow: `operation=deploy-protocol`. Secrets: deployer key and RPC. Vars: optional payment registry/oracle inputs, `FEE_RECIPIENT`, `PROTOCOL_FEE_BPS`, `X402_FACILITATOR_URL`, verification vars. | `contracts/deployments/base-sepolia.json`, `contracts/deployments/base-sepolia.remote.env`, Forge broadcast files; Sepolia writes `contracts/deployments/sepolia.json`. | Promote changed app/runtime addresses through `resonate-iac` before app deploy. Verify via Sourcify or BaseScan as needed. |
| `deploy-content-protection` | Add or replace ContentProtection for an existing `StemNFT` and `TransferValidator` without replacing the whole graph. | Workflow: `operation=deploy-content-protection`. Vars: `STEM_NFT_ADDRESS`, `TRANSFER_VALIDATOR_ADDRESS`; optional `MARKETPLACE_ADDRESS`, `EXISTING_ADMIN`. Secret: owner/admin signer. | Forge broadcast files and console summary. | Promote any changed ContentProtection/RevenueEscrow references through IaC and app config if downstream code consumes them. |
| `deploy-show-campaign-escrow` | Deploy the standalone Shows escrow for an environment. | Workflow: `operation=deploy-show-campaign-escrow`. Vars: optional `SHOW_CAMPAIGN_ESCROW_OWNER`, `SHOW_CAMPAIGN_FEE_BPS`, required remote `SHOW_CAMPAIGN_FEE_RECIPIENT`. Secret: deployer key. | `contracts/deployments/show-campaign-escrow.<network>.json`, `.remote.env`, `show-campaign-escrow.abi.json`, broadcast files. | Promote `SHOW_CAMPAIGN_ESCROW_ADDRESS` and `NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS` through `resonate-iac`. |
| `deploy-stem-marketplace` | Surgically deploy a new `StemMarketplaceV2` against an existing protocol graph. | Workflow: `operation=deploy-stem-marketplace`. Vars: `STEM_NFT_ADDRESS`, `CONTENT_PROTECTION_ADDRESS` or `CONTENT_PROTECTION_PROXY`, `PAYMENT_ASSET_REGISTRY_ADDRESS`, `FEE_RECIPIENT`; optional `PROTOCOL_FEE_BPS`, `TRANSFER_VALIDATOR_ADDRESS`. Secret: owner/admin signer. | `contracts/deployments/stem-marketplace.<network>.json`, `.remote.env`, `stem-marketplace.abi.json`, broadcast files. | Promote `MARKETPLACE_ADDRESS` and `NEXT_PUBLIC_MARKETPLACE_ADDRESS` through `resonate-iac`; confirm ContentProtection registrar and validator whitelist effects. |
| `upgrade-content-protection` | Upgrade the UUPS implementation behind an existing ContentProtection proxy. | Workflow: `operation=upgrade-content-protection`. Vars: `CONTENT_PROTECTION_PROXY`. Secret: proxy owner/admin signer. | Forge broadcast files and console summary. Proxy address stays the same. | No address promotion unless implementation metadata is tracked elsewhere. Keep the broadcast artifact for audit. |
| `set-content-protection-stake` | Change the ERC-20 stake amount required by ContentProtection. | Workflow: `operation=set-content-protection-stake`. Vars: `CONTENT_PROTECTION_ADDRESS`, `STAKE_ASSET_ADDRESS` or `PAYMENT_USDC_ADDRESS`; optional `STAKE_ASSET_AMOUNT`, `STAKE_ASSET_SYMBOL`. Secret: owner signer. | Console summary and broadcast file. No deployment handoff. | Update docs/product copy if the visible stake policy changed. |
| `set-marketplace-protocol-fee` | Change marketplace protocol fee and optionally rotate the fee recipient. | Workflow: `operation=set-marketplace-protocol-fee`. Vars: `MARKETPLACE_ADDRESS`, `NEW_PROTOCOL_FEE_BPS`; optional `NEW_FEE_RECIPIENT`. Secret: `StemMarketplaceV2` owner signer. | Console summary, workflow summary, broadcast file. | If fee economics changed beyond accepted ADR values, update the business-model RFC first. No address promotion. |
| `set-show-campaign-fee-config` | Change Shows campaign fee rate for future campaigns or rotate the charge-time fee recipient. | Workflow: `operation=set-show-campaign-fee-config`. Vars: `SHOW_CAMPAIGN_ESCROW_ADDRESS`, `NEW_FEE_BPS`, `NEW_FEE_RECIPIENT`. Secret: `ShowCampaignEscrow` owner signer. | Console summary, workflow summary, broadcast file. | Fee rate affects future campaigns only; recipient rotation applies when fees are charged. Update public/operator docs if terms changed. |
| `set-show-campaign-confirmer` | Grant or revoke a Shows booking/fulfillment confirmer. | Workflow: `operation=set-show-campaign-confirmer`. Vars: `SHOW_CAMPAIGN_ESCROW_ADDRESS`, `CONFIRMER_ADDRESS`, `CONFIRMER_ALLOWED` (`true` or `false`). Secret: escrow owner signer. | Console summary, workflow summary, broadcast file. | Confirm the backend/operator identity using that confirmer is configured outside the contract workflow. |
| `pause-show-campaign-escrow` | Pause or unpause Shows campaign pledging during incident response or after review. | Workflow: `operation=pause-show-campaign-escrow`. Vars: `SHOW_CAMPAIGN_ESCROW_ADDRESS`, `PAUSED` (`true` or `false`). Secret: escrow owner signer. | Console summary, workflow summary, broadcast file. | Coordinate app/operator messaging before and after pausing. No address promotion. |
| `create-show-campaign` | Create and immediately activate an owner-managed Shows campaign on-chain. | Workflow: `operation=create-show-campaign`. Vars: `SHOW_CAMPAIGN_ESCROW_ADDRESS`, `ARTIST_ID_HASH`, `AUTHORITY_HASH`, `BENEFICIARY`, `PAYMENT_TOKEN`, `GOAL_UNITS`, `MIN_BACKERS`, `FUNDING_DEADLINE`, `BOOKING_DEADLINE`; optional `DEPOSIT_RELEASE_BPS` (default `0`), `DISPUTE_WINDOW_SECONDS` (default `604800`). `ARTIST_ID_HASH` and `AUTHORITY_HASH` may be 32-byte `0x...` values or plain strings, which the script hashes with `keccak256`. Secret: escrow owner signer. | Console summary with prominent `CAMPAIGN_ID`, workflow summary, broadcast file. | Record the campaign ID in the backend/admin tracking source that links product campaigns to `contractCampaignId`. If you did not capture the `CAMPAIGN_ID` from the console, an operator can recover it without a re-run: on the campaign detail page the escrow field is prefilled from platform config and the **Find on-chain campaign** button (`POST /shows/campaigns/:id/discover-onchain`, #1390) matches the draft's deterministic terms — beneficiary, payment token, goal, minimum backers, funding deadline, booking deadline — and fills `contractAddress` + `contractCampaignId` before activation. |
| `confirm-show-campaign-booking` | Move a funded Shows campaign to booked after the venue/show booking is confirmed. | Workflow: `operation=confirm-show-campaign-booking`, `campaign_id=<id>`. Vars: `SHOW_CAMPAIGN_ESCROW_ADDRESS`. Secret: confirmer signer. | Console summary and workflow summary. Forge logs campaign status before and after the call. | Confirm the campaign id matches the backend/admin tracking source before running. If the transaction reverts, check campaign status, booking deadline, and confirmer allowlist. |
| `confirm-show-campaign-fulfillment` | Mark a booked Shows campaign fulfilled after the show has happened or the operator has accepted fulfillment evidence. | Workflow: `operation=confirm-show-campaign-fulfillment`, `campaign_id=<id>`. Vars: `SHOW_CAMPAIGN_ESCROW_ADDRESS`. Secret: confirmer signer. | Console summary and workflow summary. Forge logs campaign status before and after the call. | This starts the campaign's dispute window. Do not release funds until the window has elapsed. |
| `release-show-campaign-funds` | Release the remaining fulfilled campaign balance after the dispute window has elapsed. | Workflow: `operation=release-show-campaign-funds`, `campaign_id=<id>`. Vars: `SHOW_CAMPAIGN_ESCROW_ADDRESS`. Secret: deployment-safe signer key. The contract call is permissionless. | Console summary and workflow summary. Forge logs campaign status before and after the call, plus total released and total fee paid before and after so the run log shows net/fee movement. | Reconcile the Forge log with the campaign ledger/admin record. No address promotion. |
| `verify-base-sepolia` | Retry BaseScan/Etherscan verification from a prior Base Sepolia broadcast. | Workflow: `operation=verify-base-sepolia`, `target_network=base-sepolia`. Secrets: `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY`. Vars: optional `BROADCAST_FILE`, `VERIFY_ONLY`, retry/API URL vars. | Explorer verification logs. No deploy. | If verification fails because the wrong broadcast was selected, set `BROADCAST_FILE` to the exact `contracts/broadcast/.../run-*.json` artifact and rerun. |
| `verify-base-sepolia-sourcify` | Verify contracts through Sourcify without an explorer API key. Preferred retry path when a broadcast artifact exists. | Workflow: `operation=verify-base-sepolia-sourcify`, `target_network=base-sepolia`. Vars: optional `BROADCAST_FILE`, `VERIFY_ONLY`, Sourcify retry/API URL vars. | Sourcify verification logs. No deploy. | Keep the broadcast artifact with the deployment record. Sourcify reads the broadcast's creation transactions and rebuilt compiler input. |

## CP-1 Attestation Registrar (backend voucher signer)

The backend `POST /contracts/attestation-vouchers` endpoint (CP-1, #1271) signs the
EIP-712 `AttestationAuthorization` voucher that `ContentProtection.attest` /
`attestRelease` now require before an artist can attest. Its JWT-authenticated request
body is `{ releaseId, attester, contentHash, metadataURI, chainId? }` (`releaseId` is
the on-chain uint256 token id as a decimal string; `contentHash` is the 0x bytes32 of
the audio; `metadataURI` is `resonate://release/<slug>`). It signs only after verifying
(a) `attester` is a wallet the caller controls and (b) `releaseId ==
uint256(keccak256(abi.encodePacked(attester, contentHash, keccak256(bytes(metadataURI)))))`
— i.e. the id sits in the caller's own address partition, which is what prevents
squatting a foreign creator's predictable id and works for the first-ever attestation
(no `Release` row exists yet). It signs with the **same key
`POST /contracts/mint-authorizations` uses** — `MINT_AUTHORIZER_PRIVATE_KEY` (falling
back to `PRIVATE_KEY`). No new key is introduced.

That signer address **must be a registered ContentProtection registrar**, or every
voucher reverts `InvalidAttestationSignature` on-chain and no artist can attest.
Register it once per ContentProtection proxy, as the proxy owner:

```bash
cast send "$CONTENT_PROTECTION_ADDRESS" "setRegistrar(address,bool)" "$VOUCHER_SIGNER" true \
  --rpc-url "$RPC_URL" --private-key "$OWNER_KEY"
```

- `$VOUCHER_SIGNER` = the address of `MINT_AUTHORIZER_PRIVATE_KEY` (the backend voucher signer).
- Run **per chain** — each ContentProtection proxy keeps its own `registrars[]` set — after
  every fresh ContentProtection deploy or `reinitializeV5` domain migration.
- Rotation: `setRegistrar(oldSigner, false)`, register the new signer, then rotate the
  backend secret. Vouchers already signed by the old signer stay valid until their
  `ATTESTATION_VOUCHER_TTL_SECONDS` deadline passes.

## ContentProtection Ownership Handoff (two-step, CP-3)

`ContentProtection.transferOwnership(newOwner)` no longer transfers ownership in one
step (CP-3, #1271). It only **stages** `newOwner` as `pendingOwner` and emits
`OwnershipTransferStarted`; the current owner keeps full authority — including UUPS
upgrade authorization — until the new owner completes the handoff. This prevents a
mistyped or unusable address from irreversibly bricking upgrade and admin control.

Procedure (per chain / per proxy):

```bash
# 1. Current owner stages the new owner.
cast send "$CONTENT_PROTECTION_ADDRESS" "transferOwnership(address)" "$NEW_OWNER" \
  --rpc-url "$RPC_URL" --private-key "$CURRENT_OWNER_KEY"

# 2. Verify the staging took effect.
cast call "$CONTENT_PROTECTION_ADDRESS" "pendingOwner()(address)" --rpc-url "$RPC_URL"

# 3. The NEW owner accepts — this is the step that actually moves ownership
#    (emits OwnershipTransferred and clears pendingOwner).
cast send "$CONTENT_PROTECTION_ADDRESS" "acceptOwnership()" \
  --rpc-url "$RPC_URL" --private-key "$NEW_OWNER_KEY"

# 4. Confirm.
cast call "$CONTENT_PROTECTION_ADDRESS" "owner()(address)" --rpc-url "$RPC_URL"
```

- A pending handoff can be **replaced or cancelled** at any time before acceptance by
  the current owner calling `transferOwnership` again (a different address replaces the
  pending owner; there is no separate cancel — staging an owner-controlled address is
  the cancel path).
- Treat an unaccepted `pendingOwner` as an open operational task: the handoff is not
  done, and the old key must stay secured until `acceptOwnership` has confirmed.
- `PaymentAssetRegistry` still uses single-step `transferOwnership`; double-check the
  address before any handoff there.

## Emergency Freeze for Large Tracks (RE-1)

`RevenueEscrow.freezeByTrack(trackId)` freezes the track's escrows and every registered
stem's escrows in a single transaction. For tracks with very many stems this single
unbounded loop can exceed the block gas limit. Use the paginated variant
`freezeByTrackRange(trackId, startIndex, maxStems)` (RE-1, #1271) in that case:

```bash
# Page through the stems until the call reports 0 processed.
# Page 0 (startIndex = 0) also freezes the root track's own escrows.
cast send "$REVENUE_ESCROW_ADDRESS" "freezeByTrackRange(uint256,uint256,uint256)" \
  "$TRACK_ID" 0 100 --rpc-url "$RPC_URL" --private-key "$OWNER_KEY"
cast send "$REVENUE_ESCROW_ADDRESS" "freezeByTrackRange(uint256,uint256,uint256)" \
  "$TRACK_ID" 100 100 --rpc-url "$RPC_URL" --private-key "$OWNER_KEY"
# ... advance startIndex by the page size until the returned `processed` is 0.
```

- The function returns the number of stems processed; `0` means the sweep is complete.
- `ContentProtection.getTrackStemCount(trackId)` tells you the total stem count up
  front so you can size the loop.
- Freezing is idempotent per escrow — re-running a page is safe.
- `maxStems` must be non-zero (`ZeroMaxStems`); `type(uint256).max` means
  "everything from startIndex" in one page when gas allows.

## Staging Lifecycle Smoke

The **Staging Lifecycle Smoke** (`.github/workflows/staging-lifecycle-smoke.yml`,
#1392) is the automated end-to-end check for the Shows money path against the
real staging deployment. It uses the same `contracts-staging` environment and
`CONTRACT_DEPLOYER_PRIVATE_KEY` as this runbook, plus a dedicated pre-funded
smoke wallet, and runs on two schedules:

- **Nightly 05:00 UTC (`auto` mode)** — pledge + cancel + `claimRefund` loop:
  tests the refund seam end to end, restores the smoke wallet's USDC (only gas
  burns), and ends the campaign in a discovery-excluded state so no test
  campaign lingers publicly.
- **Weekly Sunday 04:00 UTC (`full` mode)** — booking → fulfillment → waits the
  real 1-hour dispute window (contract `MIN_DISPUTE_WINDOW`) → `releaseFunds` +
  on-chain/backend fee assertions. This is the fee-leg coverage; expect a
  >1-hour runtime.
- **Manual dispatch** lets you pick the mode (`auto`/`full`/`skip`). `skip`
  leaves the campaign Funded and prints cleanup commands — either a direct
  cancel/refund pair or this runbook's `confirm-show-campaign-booking` →
  `confirm-show-campaign-fulfillment` → `release-show-campaign-funds`
  operations with the campaign id.

Full operator guide, env contract, failure triage, and the smoke-wallet top-up
runbook: [`docs/features/staging_lifecycle_smoke.md`](../features/staging_lifecycle_smoke.md).
On failure it opens/comments a `smoke-failure`-labeled issue linking the run;
look for the `SMOKE_FAIL <step>: <reason>` line in the run log.

## Reconciliation-Mismatch Alert (Shows drift)

The escrow indexer reconciles on-chain truth against backend state. When it
finds drift — an on-chain event on a campaign with **no bound backend row**, or
an **on-chain pledge with no matching backend intent** — it emits
`shows.campaign_reconciliation_mismatch` (#1271). This is a **fan-safety** signal:
a real pledge (or fund movement) the backend didn't originate, or can't match.

**How the alert reaches you.** The indexer writes a structured app-event log
line (`jsonPayload.event = "shows.campaign_reconciliation_mismatch"`,
`service = "resonate-backend"`). `resonate-iac`'s log-based metric
(`backend_app_events{event="shows.campaign_reconciliation_mismatch"}`) turns any
occurrence into a **Cloud Monitoring email alert** to the ops channel. The same
drift is also written as a durable analytics fact.

**Responding to an alert:**

1. **Inspect the drift.** Call the operator endpoint (admin/operator JWT):

   ```bash
   curl -s -H "Authorization: Bearer $OPERATOR_JWT" \
     "$API_BASE/shows/operator/reconciliation-mismatches?sinceMinutes=120&limit=50" | jq .
   # Optionally filter to one campaign: &contractCampaignId=<id>
   ```

   Each row is `{ occurredAt, contractCampaignId, escrowEventName,
   transactionHash, blockNumber, reason }`. The `reason` tells you which drift
   variety it is.

2. **If the reason is "no matching backend intent"** — a pledge landed on-chain
   without a backend intent (an out-of-band pledge, a client that never called
   `/pledges/intent`, or a lost intent write). Confirm the on-chain pledge
   (`transactionHash`) is real, then `POST /shows/campaigns/:id/resync-chain` to
   re-hydrate the campaign from chain. The pledge amount is authoritative from
   chain; the fan's on-chain funds are safe in escrow. Reconcile the backer
   record manually if needed.

3. **If the reason is "no backend campaign bound…"** — an on-chain campaign has
   no linked backend row. Bind/activate the campaign (operator activation with
   the `contractCampaignId`) or, if it is not ours, record and ignore.

4. **If the reason is "funds released … while an off-chain dispute is open"** —
   chain released despite an open dispute (release is time-locked, not
   dispute-blocked on-chain). Escalate: this is a governance/dispute-window gap,
   not an indexer bug.

5. **Escalate** any drift you cannot explain from chain data — treat unexplained
   fund movement as a security event.

**Proving the alert works.** The **Staging Reconciliation Drill**
(`.github/workflows/staging-reconciliation-drill.yml`, `workflow_dispatch` only)
provokes a genuine pledge-without-intent drift on staging and asserts the
operator endpoint surfaces it. Run it after any deploy that touches the escrow
indexer. Full guide:
[`docs/features/staging_reconciliation_drill.md`](../features/staging_reconciliation_drill.md).

The same structured-app-event + log-based-metric + email-alert path also covers
`x402.refund_due_stale` (#1506) — a paid Punchline collect that could not be
fulfilled and owes an out-of-band refund; respond via the x402 refund runbook.

## Address Promotion Through IaC

Do not copy console output straight into Cloud Run or GitHub variables by hand.
Promote address changes through `resonate-iac`:

1. In `akoita/resonate-iac`, edit
   `environments/<env>/terraform.tfvars` with the reviewed contract addresses
   from this repo's `.remote.env` handoff or deployment record.
2. Refresh the protected GitHub environment secret from that file:

   ```bash
   gh secret set TERRAFORM_TFVARS --env <env> --repo akoita/resonate-iac < environments/<env>/terraform.tfvars
   ```

3. In `resonate-iac`, dispatch `deploy.yml` for the same environment in plan
   mode.
4. Review the plan output.
5. Dispatch `deploy.yml` again in apply mode.
6. Confirm backend and frontend runtime env vars match the promoted addresses.

Use this promotion path for deploy operations that produce `.remote.env`
handoffs, especially:

| Handoff | Promote |
| --- | --- |
| `contracts/deployments/base-sepolia.remote.env` | Protocol graph addresses, chain ID, x402 network values. |
| `contracts/deployments/show-campaign-escrow.<network>.remote.env` | `SHOW_CAMPAIGN_ESCROW_ADDRESS`, `NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS`. |
| `contracts/deployments/stem-marketplace.<network>.remote.env` | `MARKETPLACE_ADDRESS`, `NEXT_PUBLIC_MARKETPLACE_ADDRESS`. |

Admin/config operations normally do not need IaC promotion because they do not
change addresses. They may still require docs, feature catalog, or operator
runbook updates when they change visible product terms.

## Broadcast-Driven Verification

Foundry writes broadcast JSON under `contracts/broadcast/<Script>/<chain-id>/`.
The workflow uploads those files as artifacts after deploy/update operations.

Sourcify verification is broadcast-driven:

1. Identify the exact broadcast file for the deployment, for example
   `contracts/broadcast/DeployProtocol.s.sol/84532/run-latest.json`.
2. Set `BROADCAST_FILE` in the GitHub environment if the default is not the
   correct file.
3. Optionally set `VERIFY_ONLY=<ContractName>` to verify one contract from the
   broadcast.
4. Dispatch `verify-base-sepolia-sourcify`.

The Sourcify script rebuilds the compiler input from local Foundry metadata and
submits each broadcast creation transaction to Sourcify. It does not need an API
key.

BaseScan/Etherscan verification also reads the broadcast file, but it uses the
CI explorer key from `ETHERSCAN_API_KEY` or `BASESCAN_API_KEY`. Use
`verify-base-sepolia` when explorer verification is required or when a deploy's
automatic `verify_contracts=auto` step could not complete.
