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

### Trust Tiers & Defaults

| Tier        | Stake     | Escrow Period | Max Listing Price (at 10× multiplier) |
| ----------- | --------- | ------------- | ------------------------------------- |
| New Creator | 10 USDC when stablecoin staking is configured; native ETH fallback otherwise | 30 days | 100 USDC per unit when listed in USDC |
| Established | 10 USDC when stablecoin staking is configured; native ETH fallback otherwise | 14 days | 100 USDC per unit when listed in USDC |
| Trusted     | 10 USDC when stablecoin staking is configured; native ETH fallback otherwise | 7 days | 100 USDC per unit when listed in USDC |
| Verified Trust Tier | Waived | 3 days | Uncapped |

The trust tier above is an economic control, not an independent rights-verification badge. It affects stake, escrow, and listing economics only.
Upload staking is stablecoin-first when an enabled `upload_stake` stablecoin has an on-chain stake amount. Native ETH remains a fallback for local or partially configured environments.

## Components

### 1. Read Hooks (`hooks/useContracts.ts`)

- **`useStakeInfo(tokenId)`** — reads on-chain stake data, returns `{ amount, depositedAt, active }`
- **`useAttestationInfo(tokenId)`** — reads on-chain attestation data
- **`useStakeRefund()`** — write hook to withdraw stake after escrow expires

All hooks handle the zero-address case (contract not deployed) gracefully.

### 2. Public Badge (`components/content-protection/ContentProtectionBadge.tsx`)

Renders on **stem detail pages** (`/stem/[tokenId]`). Two modes:

- **Compact** — inline pill: `Active ✓ (10 USDC)` or the deposited native fallback
- **Expanded** — full card with status, amount, economic trust tier, escrow countdown, and self-attestation date

Reads live on-chain data via `useStakeInfo` + `useAttestationInfo`. Fetches trust tier from backend (`/api/trust-tier/{address}`).

### 3. Release Protection Section (`components/content-protection/ReleaseContentProtection.tsx`)

Renders on **release detail pages** (`/release/[id]`) — visible to all users.

- Fetches from backend indexer (`/api/content-protection/release/{id}`)
- When indexer unavailable, shows program defaults, preferring configured stablecoin staking where available — consistent with publish-time staking model
- When data available, shows live status pill, stake amount, economic tier, escrow countdown, provenance status, and rights-review status

### 4. My Stakes Dashboard (`components/wallet/MyStakesCard.tsx`)

Renders on the **wallet page** (`/wallet`). Table showing:

| Column    | Description                               |
| --------- | ----------------------------------------- |
| Token     | Release identifier                        |
| Amount    | Staked ETH                                |
| Deposited | Date of stake                             |
| Escrow    | Countdown or status                       |
| Status    | Active / Releasable / Refunded / Slashed  |
| Actions   | **Withdraw** button (when escrow expired) |

Fetches from backend (`/api/metadata/stakes/{address}`). Falls back to empty state when unavailable.

### 5. Analytics Dashboard (`components/analytics/StakingOverview.tsx`)

Renders on the **analytics page** (`/artist/analytics`). Shows:

- **4 KPI cards**: Total Staked, Protected Releases, Slashed, Refunded
- **Stake History table**: Release name, amount, date, status

Fetches from backend (`/api/metadata/stakes/analytics/{address}`).

### 6. Shared Utilities (`lib/stakeConstants.ts`)

- `deriveStakeStatus(active, amount, depositedAt, escrowDays)` → `StakeStatus`
- `deriveEscrowStatus(active, depositedAt, escrowDays)` → `{ status, daysRemaining }`
- `formatEth(wei)` → native fallback formatting such as `"0.01 ETH"` or `"Waived"`
- `formatPaymentAmountWithSymbol(amountUnits, decimals, symbol)` → stablecoin stake formatting such as `"10 USDC"`
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

- **15 unit tests** in `lib/__tests__/stakeConstants.test.ts` — `formatEth`, `deriveStakeStatus`, `deriveEscrowStatus`, label map completeness
- TypeScript build passes clean (`tsc --noEmit`)

## Dependencies

- [`ContentProtection` smart contract](../rfc/content-protection-architecture.md#9-smart-contract-architecture) — deployed, provides `stakes()`, `attestations()`, `refundStake()`
- `useAttestAndStake` hook — existing, performs atomic attest + stake at publish time
- Backend `IndexerService` — indexes `StakeDeposited` and `ContentAttested` events from on-chain
