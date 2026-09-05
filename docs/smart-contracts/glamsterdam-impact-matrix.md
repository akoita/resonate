# Glamsterdam Repricing Impact Matrix

**Issue:** [#1660](https://github.com/akoita/resonate/issues/1660)
**Evaluation date:** 2026-08-30
**Repository baseline:** `1f90df0f5981845370dea8dd9f8393d14a30573b`
**Business-model classification:** vision-neutral infrastructure and quality;
ADR-BM-6 value flows and ADR-BM-4 constraints are unchanged.

## Decision Status

Platåberget execution confirmed a deployment-estimation incompatibility, not a
first-party contract-logic regression. Foundry's default deployment estimate
left no EIP-8037 state-gas reservoir: all five initial AA contract creations
failed on-chain even though local simulation succeeded. Geth traced the
EntryPoint failure as `contract creation code storage out of gas` with
execution gas still available. The unchanged AA graph and the complete
36-transaction protocol graph both deployed successfully when broadcast with a
1,500% gas-estimate multiplier.

Static review still found no production use of Solidity `transfer` or `send`,
fixed call-gas stipends, application transaction `gasLimit` constants, or
`gasleft()`-dependent branching. Representative first-party runtime lifecycles
also succeeded on the target schedule. Application UserOperations remain
blocked by the pre-existing local Kernel/ZeroDev SDK version mismatch tracked
in [#1694](https://github.com/akoita/resonate/issues/1694).

The checked-in evidence tooling deliberately separates three states:

1. a local Cancun characterization baseline;
2. a Platåberget/devnet-8 run pinned to the frozen EIP revisions; and
3. later public-testnet, mainnet, and L2 retests when their activation signals
   become authoritative.

No production contract behavior or gas limit should change without a measured
target-schedule regression.

The checked-in [local Cancun baseline](../../audit/glamsterdam-local-baseline-2026-08-30.json)
contains 40 named observations from the focused Foundry lifecycle harness. It
is machine-readable comparison input, not evidence of Glamsterdam behavior.
The receipt-backed [Platåberget evidence](../../audit/glamsterdam-plata-2026-08-30.json)
records the failed default estimate, successful repriced deployments, and the
separately classified UserOperation blocker. The independent
[Platåberget runtime evidence](../../audit/glamsterdam-plata-runtime-2026-08-30.json)
records 26 successful lifecycle observations from a fresh ephemeral genesis,
including one deterministic Geth multi-block simulation for the one-hour
campaign release gate. Keeping the two files separate avoids mixing receipts
from different local genesis blocks.

## Pinned Upstream Inputs

| Input | Pinned evidence |
| --- | --- |
| Ethereum developer guidance | [Ethereum Foundation, 2026-08-24](https://blog.ethereum.org/2026/08/24/glamsterdam-repricing-testing) |
| EIP-8037 | [Platåberget spec commit `a12902ae`](https://github.com/ethereum/EIPs/blob/a12902ae1b811c45a81b51bfce671cf7a1fb27f3/EIPS/eip-8037.md), cost per state byte 1,530 |
| EIP-8038 | [Platåberget spec commit `fc232285`](https://github.com/ethereum/EIPs/blob/fc2322854d047ba1fd6e3ae9e61fb7a915535cb7/EIPS/eip-8038.md) |
| Execution tests | `tests-glamsterdam-devnet@v8.1.1` in the [devnet-8 specification](https://notes.ethereum.org/@ethpandaops/glamsterdam-devnet-8) |
| Historical replay | [Ethereum repricing-impact dashboard](https://ethereum.github.io/repricing-impact/) |

The dashboard covers replayed Ethereum mainnet transactions. Resonate has no
checked-in Ethereum mainnet deployment address, so an address lookup is
currently `not_applicable`, not a claim of safety. Re-run the lookup if an L1
mainnet proxy or implementation is discovered.

## Deployment Inventory

| Network | Role | Checked-in address | Provenance / disposition |
| --- | --- | --- | --- |
| Ethereum Sepolia (11155111) | StemNFT | `0xba177eb2246bb750e69021a1a8c0ceab735a0541` | `contracts/deployments/sepolia.json` |
| Ethereum Sepolia (11155111) | StemMarketplaceV2 | `0x41a3f7232099c8e5353fe449e1a28c61ed88da68` | `contracts/deployments/sepolia.json` |
| Ethereum Sepolia (11155111) | TransferValidator | `0x845bb7a30f2ddaa755dee1384cfd9989f3e194ef` | `contracts/deployments/sepolia.json` |
| Ethereum Sepolia (11155111) | ContentProtection | `0x8cf00afec3efe8f2314545ceb391c59ce78a6c11` | `contracts/deployments/sepolia.json` |
| Ethereum Sepolia (11155111) | DisputeResolution | `0xff62ec2742a7cc799d63615bd6d8f271f48e34a6` | `contracts/deployments/sepolia.json` |
| Ethereum Sepolia (11155111) | CurationRewards | `0xf3864be2fe0d932bfa6f871bd052bcfed0033c5e` | `contracts/deployments/sepolia.json` |
| Ethereum Sepolia (11155111) | RevenueEscrow | `0x411e121a97b6901b2e81f67a795e8063c1b8d472` | `contracts/deployments/sepolia.json` |
| Base Sepolia (84532) | StemNFT | `0xb50859bb6fbb0180720d7e7663fd07b4a4fa7622` | Primary and marketplace handoff records agree. |
| Base Sepolia (84532) | StemMarketplaceV2 | `0x5d6440075b2de1f69ec6ae18e1c88bfc2460ec75` | Older aggregate record; reconcile against the later handoff below before remote testing. |
| Base Sepolia (84532) | StemMarketplaceV2 | `0x85c9767fced270ab3724820389cc410956f4f397` | Later `stem-marketplace.base-sepolia.json` deployment; candidate current proxy. |
| Base Sepolia (84532) | PaymentAssetRegistry | `0xddbaf98bb5708c7809efa783dc72cc15a97ba495` | Present only in the later marketplace handoff. |
| Base Sepolia (84532) | TransferValidator | `0x87ae96c077550eb7a1dcc4a781433b4d1101e03b` | Aggregate deployment record. |
| Base Sepolia (84532) | ContentProtection | `0x8b727a56760b1017610eb54dd0ae77b3dc0ca51c` | Aggregate and marketplace handoff records agree. |
| Base Sepolia (84532) | DisputeResolution | `0x622b2c7648dcf164572c184447922b8ffbdc9ef9` | Aggregate deployment record. |
| Base Sepolia (84532) | CurationRewards | `0x4a752e3ba56b312ee55894a695fc3450606c53d8` | Aggregate deployment record. |
| Base Sepolia (84532) | RevenueEscrow | `0xb5678635fb71085ed065e4e4b8d112ae6178abf1` | Aggregate deployment record. |
| Base Sepolia (84532) | ShowCampaignEscrow | `0xd7035cf620c09653542b75a9b95bbec1514d8b23` | Later dedicated handoff; older feature docs contain a stale address. |

Checked-in handoffs do not consistently preserve proxy implementation or
timelock addresses, and ignored broadcast artifacts are unavailable. Those
fields remain `blocked` until reconciled from an authoritative deployment
handoff or chain state. `resonate-iac` is outside this repository and was not
queried.

## Static Gas-Sensitivity Review

| Surface | Evidence | Repricing disposition |
| --- | --- | --- |
| Fixed stipend / remaining-gas logic | No first-party production `.transfer`, `.send`, `call{gas: ...}`, `gasleft()`, or explicit application `gasLimit` found. Native payouts use checked low-level calls without a fixed stipend. | No static fixed-gas regression found. Recheck dependencies and generated bytecode when pins change. |
| Kernel account creation | `KernelFactory.createAccount` invokes Solady deterministic ERC-1967 CREATE2 deployment and initialization. | Highest EIP-8037 priority: compare first deployment, repeat address, value-bearing initialization, direct estimate, and UserOperation estimate. |
| ERC-4337 | Vendored EntryPoint uses protocol-defined `gasleft()` and UserOperation limits; backend/web delegate estimation to ZeroDev/bundler paths. | Protocol behavior, not a first-party fixed stipend. Requires end-to-end bundler/paymaster evidence. |
| StemNFT | Mint and remix lineage allocate ownership, supply, URI, and parent-ID storage. | Measure authorized mint and bounded maximum-parent cold/repeat cases. |
| ContentProtection | Registration/staking allocate state; whole-array revoke traverses stored stems while paginated revoke bounds work. | Measure registration, stake/refund/slash, whole-array, and paginated paths separately. |
| StemMarketplaceV2 | Listing, partial/full buys, fee/royalty accounting, and failed-payment recovery update several storage domains. | Measure first/repeat listings and purchases plus recovery; preserve value-flow assertions. |
| RevenueEscrow | First/repeat deposits, asset tracking, release/redirect/recovery, and track freeze allocate or traverse state. | Measure first versus repeat asset slots and bounded multi-asset/freeze paths. |
| ShowCampaignEscrow | Campaign creation, first/repeat pledges, release, cancellation, and refund update campaign and contributor state. | Measure happy and refund lifecycles with first/repeat state variants. |
| PaymentAssetRegistry | Configuration creates entries; enumeration grows with registered assets. | Measure first/reconfiguration and bounded listing growth. |
| DisputeResolution | Juror selection/removal and appeal paths traverse pools and allocate dispute state. | Measure bounded pool sizes and record any block-gas or estimator inflection. |
| CurationRewards | Allocation and payout update reward state and perform checked value transfers. | Measure first/repeat allocation and withdrawal/recovery behavior. |
| Deployment/proxy initialization | Deployment scripts create implementations/proxies and initialize roles/state. | Characterize local deployment receipts; target-network upgrade execution requires explicit operator authority. |

## Execution Matrix

`pending` means evidence has not run; `blocked` names an external prerequisite.
The final outcome vocabulary follows the Ethereum replay categories while the
machine-readable evidence uses stable snake-case identifiers.

| Workflow | Baseline variant | Baseline | Platåberget | Current classification / next evidence |
| --- | --- | --- | --- | --- |
| Protocol deployment and proxy initialization | first deployment / initialized proxy | partial local setup coverage | succeeds with repriced gas | All 36 transactions succeeded with a 1,500% estimate multiplier. StemNFT used `21,696,609`; ContentProtection implementation `28,896,226`; Marketplace implementation `16,096,189`. Runtime lifecycles remain pending. |
| KernelFactory + ERC-4337 | first CREATE2, repeat call, direct and sponsored UO | CREATE2 `99,055`; repeat `2,277`; UO not exercised | partial / blocked | EntryPoint and legacy Kernel graph deployed with repriced gas; Alto initialized and advertised the custom EntryPoint. UserOperation account derivation is blocked by the local Kernel `initialize(address,bytes)` versus SDK `KERNEL_V3_1` initialization mismatch. |
| StemNFT | authorized mint, remix with parent storage | original `237,982`; repeat mint `7,165`; remix `213,857` | succeeds with repriced gas | Original/repeat/remix storage and a registrar-signed protected mint succeeded; the protected mint used `1,193,332` gas. |
| ContentProtection | registration, stake, refund/slash, whole and paginated revoke | registration/revoke covered; custody paths remain in focused unit suites | succeeds with repriced gas | Attestation, native stake, track/stem registration, refund, slash, and bounded whole-release revoke succeeded. Paginated behavior remains covered by the local focused harness. |
| Marketplace | list, partial/full buy, fee/royalty, failed receiver recovery | list `145,075`; partial `146,690`; full `51,086` | succeeds with repriced gas | Native list and partial/full purchases succeeded. A deliberately rejected royalty was escrowed without reverting the sale and later claimed. |
| RevenueEscrow | first/repeat and multi-asset deposit, release/redirect/recovery | first `149,715`; repeat `14,363`; release/recovery covered | succeeds with repriced gas | Native first/repeat deposits, native release, native failed-payout recovery, a second ERC-20 asset, per-asset freeze, and ERC-20 redirect succeeded. |
| ShowCampaignEscrow | create, first/repeat pledge, release, cancel/refund | create, pledge, release, missed-deadline refund covered | succeeds with repriced gas | Create/fund and real missed-deadline refund transactions succeeded. Geth `eth_simulateV1` advanced the same funded state through booking, fulfillment, and final release after the one-hour dispute window. |
| Registry/dispute/curation | first/repeat allocation and bounded traversal | first/repeat configuration, dispute, and report covered | succeeds with repriced gas | Native asset reconfiguration and a staked curation report with nested dispute creation succeeded. Bounded-size traversal remains covered by the local harness. |

## Reproduce And Retain Evidence

Run the local characterization without an RPC:

```bash
cd contracts
forge test --match-path test/integration/GlamsterdamRepricing.t.sol -vvv
```

Validate the sanitized evidence format from the repository root:

```bash
node --test scripts/glamsterdam-impact/*.test.mjs
node scripts/glamsterdam-impact/validate-evidence.mjs \
  scripts/glamsterdam-impact/evidence.template.json
```

Launch the minimal pinned Platåberget topology with Kurtosis 1.20.0 or newer:

```bash
kurtosis run --enclave resonate-plata-1660 \
  github.com/ethpandaops/ethereum-package@4667e182e0459dee043a2f918d2845d6a66c96a1 \
  --args-file scripts/glamsterdam-impact/kurtosis-plata.yaml
```

Inspect the enclave to obtain the published EL RPC port. After epoch 1, deploy
with target-chain state-gas headroom:

```bash
cd contracts
ALLOW_DEFAULT_ANVIL_PRIVATE_KEY=true forge script script/DeployLocalAA.s.sol \
  --rpc-url "$PLATABERGET_RPC_URL" --broadcast \
  --gas-estimate-multiplier 1500
```

The 1,500% multiplier is characterization headroom, not a proposed permanent
production constant. Production tooling should estimate against the target
chain and account for EIP-8037's state-gas reservoir. Remove the scoped enclave
with `kurtosis enclave rm -f resonate-plata-1660` after testing.

After deployment, export the resulting contract addresses plus a funded second
local participant key, then execute the checked-in runtime phases:

```bash
cd contracts
forge script script/GlamsterdamRuntime.s.sol --tc GlamsterdamRuntime \
  --rpc-url "$PLATABERGET_RPC_URL" --broadcast \
  --gas-estimate-multiplier 1500
forge script script/GlamsterdamRuntime.s.sol --tc GlamsterdamRuntime \
  --sig 'runRecovery()' --rpc-url "$PLATABERGET_RPC_URL" --broadcast \
  --gas-estimate-multiplier 1500
forge script script/GlamsterdamRuntime.s.sol --tc GlamsterdamRuntime \
  --sig 'runAssetEscrow()' --rpc-url "$PLATABERGET_RPC_URL" --broadcast \
  --gas-estimate-multiplier 1500
```

`GLAMSTERDAM_PARTICIPANT_PRIVATE_KEY` and the deployment key are runtime-only
inputs. Broadcast caches are ignored and must not be retained. The future
campaign-release branch uses Geth's documented
[`eth_simulateV1`](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth#eth_simulatev1)
multi-block state simulation; the evidence schema distinguishes that result
from a mined receipt and never assigns it a transaction hash.

The collector is deliberately read-only. Start from a sanitized copy of the
template containing supplied estimates, transaction hashes, and UserOperation
hashes; then provide the endpoint only through the environment:

```bash
GLAMSTERDAM_RPC_URL='<operator-supplied>' \
GLAMSTERDAM_RPC_IDENTIFIER='glam-devnet-8-local' \
node scripts/glamsterdam-impact/collect-evidence.mjs seed.json evidence.json
```

It permits only chain metadata and transaction-receipt RPC methods, does not
accept a private key, does not submit transactions, and rejects retained URLs,
credential-shaped fields, and signed transaction material. A successful
single-network receipt is conservatively recorded as
`succeeds_with_repriced_gas`; `unchanged` requires explicit matching baseline
and candidate evidence. Final Ethereum-category classification remains a
reviewed matrix decision.

## Chain Applicability And Retest Triggers

- **Ethereum L1:** EIP-8037/8038 are scheduled for Glamsterdam. Repeat the
  dashboard lookup when a mainnet address exists, execute on the relevant public
  testnet when the fork schedule is announced, and repeat before mainnet
  activation using the final client/spec release.
- **Base and OP Stack:** no same-time activation is inferred. Retest when the
  OP Stack protocol release notes or Base network upgrade notice explicitly
  adopt equivalent execution gas and state-gas rules. Upstream OP Stack has
  already changed `op-deployer` to estimate broadcast gas against the target
  chain rather than the build environment ([commit `733efca`](https://github.com/ethereum-optimism/optimism/commit/733efca)),
  which reinforces this chain-specific boundary but does not announce Base
  activation. Until then, Base Sepolia records are deployment inventory, not
  Glamsterdam execution evidence.
- **Platåberget/devnet-8:** the specification documents local Kurtosis client
  images but no public RPC/bundler credentials. A local devnet run requires the
  documented client images and tooling; a shared endpoint requires an operator
  handoff. Record chain ID, client images, fork block/epoch, EIP commits, and
  redacted endpoint identifier with every run.

## Validation Evidence

| Check | Result | Interpretation |
| --- | --- | --- |
| Focused Foundry characterization | 9/9 tests passed on Forge 1.4.3, solc 0.8.28, Cancun. | Produced the 40 named local observations linked above. This is a comparison baseline, not a target-schedule run. |
| Existing focused fuzz suites | 59/59 tests passed with the CI profile (64 runs per fuzz case). | Covers mint/remix, registry, content-protection custody, marketplace payment distribution, revenue escrow, and show escrow boundaries. |
| Existing invariant suites | 20/20 invariants passed with 16 runs and 240 calls per run. | Conservation, custody, fee, and lifecycle properties remained green. The repository profile permits bounded handler reverts in some suites; no invariant failed. |
| Evidence tooling | 9/9 Node tests passed; template and JSON files validate. | Rejects URL/credential leakage, distinguishes receipts from deterministic simulation, distinguishes ordinary estimate headroom from harmful underestimation, and requires explicit baseline/candidate evidence before `unchanged`. |
| Static gas-pattern review | First-party source scan found no production `transfer`, `send`, fixed call gas, `gasleft()` branch, or application gas-limit constant. | The remaining priorities are state creation, storage growth, and estimator behavior. |
| Slither 0.11.3 | Compiled 41 first-party contracts; detector run emitted 122 leads. Relevant repricing leads were full-gas low-level value calls, CREATE2/account creation, and a costly juror-pool loop. | No lead establishes a fixed-gas repricing regression. Existing security leads require their own attack-path validation and are not promoted by this evaluation. The `not-pausable` printer crashed inside Slither with an `isinstance` API error after the other printers ran. |
| Halmos 0.3.3 | Best-effort run stopped after roughly 90 seconds while still compiling 228 files; no symbolic result was produced. | Explicitly incomplete. No production contract behavior changed in this branch, so existing formal harnesses were not modified. |
| Mutation | Not run. | No production Solidity implementation changed; there is no behavior mutation to validate. Reconsider if target evidence produces a source fix. |
| Platåberget deployment | Minimal Geth/Lodestar devnet reached Amsterdam at epoch 1; AA deployment failed with default estimates, then AA and all 36 protocol transactions succeeded with a 1,500% multiplier. | Confirms target-chain deployment headroom is required. No production Solidity change is indicated. |
| Platåberget ERC-4337 | Alto initialized against the deployed EntryPoint and returned it from `eth_supportedEntryPoints`; its helper deployment succeeded. Application UserOperation did not reach submission. | Blocked by the pre-existing local Kernel v2.4-compatible initialization surface versus the app's ZeroDev `KERNEL_V3_1` encoding. This is distinct from Glamsterdam repricing. |
| Platåberget protocol runtime | 26 sanitized successful observations cover protected mint/remix, content registration and custody, marketplace sale/recovery, native and ERC-20 escrow paths, campaign funding/release/refund, and registry/dispute/curation state. | No first-party runtime regression was found. The one-hour campaign release is an explicit successful `eth_simulateV1` result; the other retained runtime observations are mined receipts. |

The Aderyn complementary analyzer is not installed. Install it, if a later
operator environment requires the second static pass, with the upstream
installer documented by Cyfrin; do not treat its absence as a successful scan.

## Change-Impact Disposition

This work adds test/evidence infrastructure and documentation only. It changes
no user-visible product capability, API, analytics, permissions, privacy,
moderation, application configuration, deployed contract, or data lifecycle.
Deployment documentation is relevant because address provenance and target
network authority constrain the evaluation; any reconciliation discovered by
remote evidence must update the canonical handoff rather than this matrix
alone.
