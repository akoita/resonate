---
title: "Custody Upgrade And Emergency Recovery"
status: partial
owner: "@akoita"
---

# Custody Upgrade And Emergency Recovery

## Status

`partial` — `ShowCampaignEscrow` and `RevenueEscrow` use the guarded UUPS
posture. `StemMarketplaceV2` remains immutable pending its separate issue
[#1300](https://github.com/akoita/resonate/issues/1300) slice; `StemNFT` and
`TransferValidator` remain intentionally swap-oriented while their final stance
is recorded in the upgradeability RFC.

## Who This Is For

- protocol developers changing contracts that hold or route funds;
- operators responding to a custody incident;
- reviewers validating upgrade authority, storage compatibility, and recovery;
- deployers promoting a replacement proxy into an application environment.

## Value

Custody contracts need a way to patch a discovered vulnerability without
turning one administrator key into an instant rewrite key. Resonate separates
the fast and slow controls:

- the operational owner can pause fund movement immediately;
- implementation upgrades go through a `TimelockController`;
- the owner and an independent guardian can each veto the other's scheduled
  upgrade;
- the guardian can drive a delayed recovery upgrade if the owner is lost;
- committed storage-layout snapshots and the full contract test ladder guard
  proxy state across implementation changes.

The timelock is a review and veto window, not a user withdrawal window.
Escrow-specific release and refund rules remain authoritative.

## Implemented Contracts

### `ShowCampaignEscrow`

The Shows proxy has separate operational and upgrade authority, a minimum
48-hour timelock in shared environments, an independent guardian recovery path,
and a pause that freezes campaign fund movement and lifecycle transitions.

### `RevenueEscrow`

The revenue proxy preserves per-token native/ERC-20 escrow, dispute freeze,
redirect, permissionless expiry release, and failed-payment recovery. Its global
pause blocks deposits, releases, redirects, and failed-payment claims while
leaving reads, per-escrow freeze controls, configuration, ownership recovery,
and upgrade governance available.

`RevenueEscrow` changed from a standalone constructor deployment to a fresh
proxy graph. An existing standalone address cannot be upgraded in place. Any
environment replacing one must explicitly audit or settle its outstanding
balances, deploy the new graph, update authorized depositors and linked content
protection, and promote the proxy address through deployment configuration.

## Authority Model

| Authority | Capability |
| --- | --- |
| Operational owner / multisig | Day-to-day configuration, dispute actions, and instant pause/unpause. Uses two-step ownership on `RevenueEscrow`. |
| Timelock | Sole UUPS `upgradeAuthority`; executes only scheduled, delay-elapsed upgrades and authority rotation. |
| Independent guardian | Timelock proposer, executor, and canceller; can veto the owner and independently drive delayed recovery. |
| Deployer | Bootstrap only; renounces `DEFAULT_ADMIN_ROLE` after wiring the guardian. |

No EOA retains timelock admin after deployment; the timelock is
self-administered.

## Operator Use

Use the **Smart Contract Deployment** workflow or the matching Make targets.
Run `preflight` before any shared-network operation.

Revenue escrow operations:

- `deploy-revenue-escrow` — deploy implementation, timelock, and proxy; verify
  the authority graph; emit JSON, `.remote.env`, and ABI handoffs;
- `pause-revenue-escrow` — set or clear the global custody pause;
- `upgrade-revenue-escrow` — schedule or execute a UUPS upgrade through the
  timelock after the configured delay.

Important environment variables:

- `REVENUE_ESCROW_OWNER`
- `REVENUE_ESCROW_GUARDIAN`
- `REVENUE_ESCROW_TIMELOCK_MIN_DELAY`
- `REVENUE_ESCROW_PERIOD`
- `REVENUE_ESCROW_ADDRESS`
- `REVENUE_ESCROW_TIMELOCK_ADDRESS`
- `UPGRADE_ACTION`
- `NEW_IMPLEMENTATION` for the execute phase

Shared-network deployment requires explicit owner and guardian addresses. The
guardian must differ from both owner and deployer, and the delay cannot be less
than 48 hours.

## Developer Verification

```bash
cd contracts
forge test --match-contract 'RevenueEscrow.*Test' -vv
forge test --match-path 'test/integration/RevenueEscrowTimelock.t.sol' -vv
halmos --contract RevenueEscrowFormalTest
bash scripts/check-storage-layout.sh
certoraRun certora/conf/revenue_escrow.conf
```

The RevenueEscrow suites cover native and ERC-20 conservation, freeze/release/
redirect behavior, pause coverage, access control, timelock delay, mutual veto,
guardian recovery, and live custody state surviving an upgrade.

## References

- Contract: `contracts/src/core/RevenueEscrow.sol`
- Interface: `contracts/src/interfaces/IRevenueEscrow.sol`
- Deployment workflow: `.github/workflows/contracts-deploy.yml`
- Operator runbook: `docs/smart-contracts/operations-runbook.md`
- Deployment guide: `docs/smart-contracts/deployment.md`
- Design rationale: `docs/rfc/contract-upgradeability-and-recovery.md`
- Tracking: [#1300](https://github.com/akoita/resonate/issues/1300)
