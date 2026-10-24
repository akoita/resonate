---
title: "Stake Visibility Views — Public Badge + Artist Dashboard"
status: implemented
owner: "@akoita"
issue: 421
depends_on: [content-protection-architecture]
---

# Stake Visibility Views

> **Reference:** [Content Protection Architecture RFC](../rfc/content-protection-architecture.md) — this feature implements the **frontend visibility layer** for Phase 2 (Economic Deterrents).

## Goal

Surface Content Protection stake information to **two audiences**:

1. **Public users** — see that a release/stem is backed by a refundable stake (trust signal)
2. **Artists** — manage their active stakes, track escrow periods, and withdraw when eligible

## Architecture

Staking is **atomic with publishing**. When an artist publishes a release, the `useAttestAndStake` hook batches `ContentProtection.attestRelease()` + `ContentProtection.stakeForRelease()` into a single UserOperation signed by the artist's passkey. This means **every published release has a stake deposited on-chain at the release root that tracks and stems inherit from**.

```
Upload → Process (Demucs) → Publish → attestRelease() + stakeForRelease() (single UserOp) → Live
                                                        │
                                                ContentProtection contract
                                                stores release-root stake + attestation
```

### Contract Interface (Read)

| Function                      | Returns                                                                                                               | Used By                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `stakes(tokenId)`             | `(uint256 amount, uint256 depositedAt, bool active)`                                                                  | `useStakeInfo` hook                        |
| `attestations(tokenId)`       | `(bytes32 contentHash, bytes32 fingerprintHash, string metadataURI, address attester, uint256 timestamp, bool valid)` | `useAttestationInfo` hook                  |
| `getMaxListingPrice(tokenId)` | `uint256` — max allowed listing price per unit (`stake × maxPriceMultiplier`, or `type(uint256).max` if unstaked)     | `StakeDepositCard`, backend `TrustService` |
| `maxPriceMultiplier()`        | `uint256` — current global multiplier (default: 10)                                                                   | Backend `TrustService`                     |
| `refundStake(tokenId)`        | — (write)                                                                                                             | `useStakeRefund` hook                      |

### Economic Trust Tiers & Defaults

| Tier        | Stake     | Escrow Period | Max Listing Price (at 10× multiplier) |
| ----------- | --------- | ------------- | ------------------------------------- |
| New Creator | 5 USDC per release track when stablecoin staking is configured; native ETH fallback otherwise | 30 days | 50 USDC per release track when listed in USDC |
| Established | 5 USDC per release track when stablecoin staking is configured; native ETH fallback otherwise | 14 days | 50 USDC per release track when listed in USDC |
| Trusted     | 5 USDC per release track when stablecoin staking is configured; native ETH fallback otherwise | 7 days | 50 USDC per release track when listed in USDC |
| Verified Economic Tier | Waived | 3 days | Uncapped |

The economic trust tier above is an economic control, not an independent rights-verification badge. It affects stake, escrow, and listing economics only.
Upload staking is stablecoin-first when an enabled `upload_stake` stablecoin has an on-chain stake amount. The upload flow multiplies the per-track stake by the number of release tracks. Native ETH remains a fallback for local or partially configured environments.

## Components

### 1. Read Hooks (`hooks/useContracts.ts`)

- **`useStakeInfo(tokenId)`** — reads on-chain stake data, returns `{ amount, depositedAt, active, assetToken, assetSymbol, assetDecimals }` (the stake currency is read from `stakeTokens(tokenId)`; ERC-20 symbol/decimals are read on-chain)
- **`useAttestationInfo(tokenId)`** — reads on-chain attestation data
- **`useStakeRefund()`** — write hook to withdraw stake after escrow expires

All hooks handle the zero-address case (contract not deployed) gracefully.

### 2. Public Badge (`components/content-protection/ContentProtectionBadge.tsx`)

Renders on **stem detail pages** (`/stem/[tokenId]`). Two modes:

- **Compact** — inline pill: `Active ✓ (5 USDC)` for a one-track release or the deposited native fallback
- **Expanded** — full card with status, amount, economic trust tier, escrow countdown, and self-attestation date

Reads live on-chain data via `useStakeInfo` + `useAttestationInfo`. Fetches trust tier from backend (`/api/trust-tier/{address}`).

### 3. Release Protection Section (`components/content-protection/ReleaseContentProtection.tsx`)

Renders on **release detail pages** (`/release/[id]`) — visible to all users.

- Fetches from backend indexer (`/api/content-protection/release/{id}`)
- When indexer unavailable, shows the program policy without asserting an amount (the amount depends on the creator's tier and stake currency)
- When data available, shows live status pill, stake amount in the stake's own asset (`stakeAssetSymbol` / `stakeAssetDecimals`, e.g. `5 USDC`; ETH stakes append the USD value when known, e.g. `0.002 ETH (≈ $5)`; before anything is staked the USD requirement is shown, e.g. `$5 required`), economic tier, escrow countdown, provenance status, and rights-review status

### 4. My Stakes Dashboard (`components/wallet/MyStakesCard.tsx`)

Renders on the **wallet page** (`/wallet`). Table showing:

| Column    | Description                               |
| --------- | ----------------------------------------- |
| Token     | Release identifier                        |
| Amount    | Staked amount in the stake's own asset (e.g. `5 USDC`, `0.005 ETH`) |
| Deposited | Date of stake                             |
| Escrow    | Countdown or status                       |
| Status    | Active / Releasable / Refunded / Slashed  |
| Actions   | **Claim** button, or why not: "Claimable on <date>", "On hold: under dispute", "Claim date pending" |

Fetches from backend (`/api/metadata/stakes/{address}`). Falls back to empty state when unavailable.

**Self-claim (#1759).** A creator withdraws their own stake with
`ContentProtection.claimStakeRefund` (V7) through the `useStakeClaim` UserOp hook;
no operator action is needed. The endpoint adds the contract's live claim state to
each active stake: `claimableAt`, `failSafeAt`, `locked`, `claimable`. These are read
from `getStakeClaimState`, not stored. The Claim button appears only when
`claimable` is true, so the wallet never shows a control that would revert.
`deriveStakeClaimAction` in `lib/stakeConstants.ts` maps the state to the label.
The escrow column uses the contract's recorded deadline when known. The indexer
now handles `StakeRefunded(WithAsset)` and `StakeRefundClaimed`, marking the stake
row inactive with `refundedAt`. Rules:

- The claim opens at the deposit time plus the longest tier escrow, snapshotted
  per stake. The contract cannot tell a stake's tier, so it never opens earlier
  than any tier allows.
- An open dispute holds the stake. The hold is released on a Rejected or
  Inconclusive outcome, kept on Upheld for the slash, and capped at 180 days past
  the escrow (owner decision, 2026-10-24).
- Stakes deposited before the V7 upgrade show "Claim date pending" until the
  operator runs the backfill. Rollout steps are in the
  [operations runbook](../smart-contracts/operations-runbook.md#contentprotection-self-claim-rollout-v7-1759).
- ADR-BM-6: vision-neutral infrastructure/quality. A creator's own deposit returns
  to the creator, with no fee, price, split, or revenue-line change; ADR-BM-4 is not
  implicated.

Status: the contract, indexer, API, and wallet control ship in this branch.
Each environment still needs the upgrade, the backfill, and the dispute-lock
authorisation (deployment half: resonate-iac#324). The lock is set by the dispute
flow only where a lock-capable `DisputeResolution` (v2.1.0+) is deployed.

### 5. Analytics Dashboard (`components/analytics/StakingOverview.tsx`)

Renders on the **analytics page** (`/artist/analytics`). Shows:

- **4 KPI cards**: Total Staked, Protected Releases, Slashed, Refunded
- **Stake History table**: Release name, amount (in each stake's own asset), date, status

`Total Staked` and the slashed total are grouped per asset (`totalStakedByAsset` / `totalSlashedByAsset`, e.g. `10 USDC + 0.002 ETH (≈ $5)`); base units are never summed across assets. `totalStaked` / `totalSlashed` remain as the native-ETH subtotal for older clients.

Fetches from backend (`/api/metadata/stakes/analytics/{address}`).

### 6. Shared Utilities (`lib/stakeConstants.ts`)

- `deriveStakeStatus(active, amount, depositedAt, escrowDays)` → `StakeStatus`
- `deriveEscrowStatus(active, depositedAt, escrowDays)` → `{ status, daysRemaining }`
- `formatStakeAmount(amount, { symbol, decimals, usd })` → exact (no floating point, never exponent notation) formatting in the stake's own asset: `"5 USDC"`, `"0.005 ETH"`, `"Waived"` for zero. Stablecoins show up to 2 decimals, 18-decimal assets up to 6
- `formatStakeTotals(totals)` → per-asset totals such as `"10 USDC + 0.002 ETH"`
- `formatReleaseStake(data)` → the release page stake cell
- `formatEth(wei)` → thin wrapper for genuine 18-decimal native ETH values only
- Label/color maps for all statuses and tiers

## Page Integration Map

| Page                | Component                           | Data Source                | Visible To          |
| ------------------- | ----------------------------------- | -------------------------- | ------------------- |
| `/stem/[tokenId]`   | `ContentProtectionBadge` (expanded) | On-chain via hooks         | All users           |
| `/release/[id]`     | `ReleaseContentProtection`          | Backend indexer / defaults | All users           |
| `/wallet`           | `MyStakesCard`                      | Backend indexer            | Authenticated owner |
| `/artist/analytics` | `StakingOverview`                   | Backend indexer            | Authenticated owner |

## Backend Endpoints

| Endpoint                                        | Status      | Fallback                |
| ----------------------------------------------- | ----------- | ----------------------- |
| `GET /metadata/content-protection/release/{id}` | Implemented | Shows program defaults  |
| `GET /metadata/stakes/{address}`                | Implemented | Shows "No stakes found" |
| `GET /metadata/stakes/analytics/{address}`      | Implemented | Shows empty dashboard   |

## Testing

- Unit tests in `lib/__tests__/stakeConstants.test.ts` — `formatStakeAmount` (USDC, ETH, zero, large values, no exponent notation), `formatStakeTotals`, `formatReleaseStake`, `formatEth`, `deriveStakeStatus`, `deriveEscrowStatus`, label map completeness
- TypeScript build passes clean (`tsc --noEmit`)

## Dependencies

- [`ContentProtection` smart contract](../rfc/content-protection-architecture.md#9-smart-contract-architecture) — deployed, provides `stakes()`, `attestations()`, `refundStake()`
- `useAttestAndStake` hook — existing, performs atomic attest + stake at publish time
- Backend `IndexerService` — indexes `StakeDeposited` and `ContentAttested` events from on-chain
