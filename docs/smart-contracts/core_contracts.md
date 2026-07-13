# Core Smart Contracts

## Overview

The Resonate Protocol core contracts implement:

- **Stem NFTs** (ERC-1155) with remix lineage tracking
- **Enforced royalties** via EIP-2981 + marketplace enforcement
- **Transfer validation** for royalty-compliant transfers
- **0xSplits integration** for revenue distribution
- **Content protection** with staking, slashing, and blacklisting (Phase 2)
- **Revenue escrow** with freeze/release/redirect for dispute resolution (Phase 2)
- **Show campaign escrow** with thresholds, refunds, artist-authority binding,
  booking confirmation, fulfillment confirmation, and staged release

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      CORE (Required)                            │
├─────────────────────────────────────────────────────────────────┤
│  StemNFT.sol          │  StemMarketplaceV2.sol                  │
│  - ERC1155 + EIP-2981 │  - Listings/Offers                      │
│  - Remix lineage      │  - Enforced royalties                   │
│  - Validator hook     │  - Routes to 0xSplits                   │
│  - Attestation gate   │                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│              CONTENT PROTECTION LAYER (Phase 2)                 │
├─────────────────────────────────────────────────────────────────┤
│  ContentProtection.sol│  RevenueEscrow.sol                      │
│  - UUPS upgradeable   │  - Per-token escrow                     │
│  - Attest/Stake/Slash │  - Deposit/Freeze/Release               │
│  - Blacklist system   │  - Redirect on dispute                  │
│  - 60/30/10 slash     │  - Permissionless release               │
├─────────────────────────────────────────────────────────────────┤
│                    MODULES (Optional)                           │
├─────────────────────────────────────────────────────────────────┤
│  TransferValidator.sol│  0xSplits (external)                    │
│  - Whitelist + blacklist│  - Revenue splitting                  │
│  - Plug into StemNFT  │  - Battle-tested                        │
└─────────────────────────────────────────────────────────────────┘
```

## Contracts

### StemNFT.sol

ERC-1155 multi-token contract for audio stems with:

- **Remixable flag** - Controls whether stem can be used in remixes
- **Parent tracking** - Links remixes to their source stems
- **EIP-2981 royalties** - On-chain royalty information (max 10%)
- **Transfer validator hook** - Optional royalty enforcement

```solidity
// Mint original stem
uint256 stemId = stemNFT.mint(
    recipient,       // to
    100,             // amount (editions)
    "ipfs://Qm...",  // tokenURI
    royaltyReceiver, // royalty recipient (can be 0xSplits address)
    500,             // 5% royalty
    true,            // remixable
    new uint256[](0) // no parents = original
);

// Mint remix
uint256[] memory parents = new uint256[](2);
parents[0] = stemId1;
parents[1] = stemId2;
uint256 remixId = stemNFT.mint(
    recipient,
    50,
    "ipfs://Qm...",
    royaltyReceiver,
    300,             // 3% royalty
    true,
    parents          // links to parent stems
);
```

### StemMarketplaceV2.sol

Native marketplace with enforced royalties:

- Reads royalty info from EIP-2981
- Automatically routes royalties on every sale
- Caps royalties at 25% to prevent abuse
- Protocol fee (configurable, max 5%)
- **Stake-to-price enforcement** — listing price per unit cannot exceed `maxPriceMultiplier × stake` (via `ContentProtection.getMaxListingPrice()`)

```solidity
// List stems for sale (price must be within stake cap)
uint256 listingId = marketplace.list(
    tokenId,        // stem to sell
    amount,         // quantity
    pricePerUnit,   // ETH price per unit (capped by stake)
    address(0),     // payment token (0 = ETH)
    7 days          // duration
);

// List immediately after minting (links stem to release for price cap)
uint256 listingId = marketplace.listLastMint(
    amount,         // quantity
    pricePerUnit,   // ETH price per unit
    address(0),     // payment token (0 = ETH)
    7 days,         // duration
    releaseId       // release root for stake-to-price resolution
);

// Buy from listing (royalties enforced automatically)
marketplace.buy{value: totalPrice}(listingId, buyAmount);
```

### TransferValidator.sol

Optional module to whitelist royalty-compliant operators:

- Whitelist trusted marketplaces
- Block blacklisted addresses (integrated with ContentProtection)
- Plugs into StemNFT's transfer hook

```solidity
// Admin whitelists marketplace
validator.setWhitelist(address(marketplace), true);

// Connect to StemNFT
stemNFT.setTransferValidator(address(validator));

// Link ContentProtection for blacklist checks
validator.setContentProtection(address(contentProtection));
```

### ContentProtection.sol (Phase 2)

UUPS-upgradeable contract for anti-piracy enforcement:

- **Attestation** — Creators register release / content provenance on-chain
- **Staking** — fixed ETH or ERC-20 deposit required per tokenId (anti-spam
  deterrent). The contract records and holds only the configured required stake:
  a native overpayment is refunded at stake time, and the ERC-20 path pulls only
  the required amount — overpayment can never inflate the slashable stake or the
  stake-backed price cap (#1280).
- **Slashing** — On confirmed infringement: 60% reporter, 30% treasury, 10%
  retained (of the recorded required stake). The 10% "burn" is **retained, not
  destroyed**: it accrues per-asset in `totalBurned` and the owner sweeps it to the
  treasury via `sweepBurned(token)`, so it is never permanently locked (#1282). The
  UUPS implementation reserves a trailing `__gap` for upgrade-safe storage (#1281).
- **Blacklisting** — Repeat offenders blocked from all protocol operations
- **Hierarchy** — Releases and tracks are directly protected; stems inherit verification from a canonical parent track
- **Stake-to-price proportionality** — `maxPriceMultiplier` (default 10×) caps listing price relative to staked amount, preventing high-price listings with minimal stakes

```solidity
// 1. Attest the release root / protected content record
contentProtection.attestRelease(
    releaseId,
    contentHash,      // keccak256 of audio
    fingerprintHash,  // acoustic fingerprint hash
    "ipfs://Qm..."    // metadata URI
);

// 2. Stake ETH for the protected release root
contentProtection.stakeForRelease{value: 0.01 ether}(releaseId);

// 3. Query the max listing price for a stem (stake × multiplier)
uint256 maxPrice = contentProtection.getMaxListingPrice(stemTokenId);

// 4. Admin: set the price multiplier (governance)
contentProtection.setMaxPriceMultiplier(15); // 15× stake

// 5. Admin: slash on confirmed theft
contentProtection.slash(releaseId, reporterAddress);

// 6. Admin: refund stake after clean escrow period
contentProtection.refundStake(releaseId);
```

Hierarchy model:

- releases are the canonical protected roots that publish flow attests and stakes
- tracks are directly attested only when they need their own disputeable provenance record
- each stem token is linked to one canonical parent track via `registerStem(trackId, stemTokenId)`
- stems can also be **directly linked** to a release root via `registerStemProtectionRoot(releaseId, stemTokenId)`
- protected mints now register that release-root link during `StemNFT` minting, so later resale listings through `list()` still enforce the same stake cap
- `listLastMint()` also registers the release-root link before creating the listing, which preserves enforcement for mint-and-list flows
- `resolveStakeRoot(tokenId)` walks the hierarchy (direct root → canonical track → parent release → self) to find the active stake
- `getMaxListingPrice(tokenId)` returns `stake × maxPriceMultiplier`, or `type(uint256).max` if no active stake exists
- `isTrackVerified(trackId)` requires both the track attestation and its parent release attestation to remain valid
- `isStemVerified(stemTokenId)` resolves the canonical track and inherits that verification status
- mint authorization checks the signed `protectionId` release root, not a freshly minted stem token
- disputes reported against a stem resolve to its canonical `trackId`, which allows escrow freezing and slashing to cascade across derived stems

### RevenueEscrow.sol (Phase 2)

Holds sale revenue per tokenId until escrow period expires:

- **Deposit** — Accumulates revenue per token. **Permissioned**: only the owner or
  an allowlisted depositor (`setDepositor`) may deposit, because the first deposit
  binds the escrow's beneficiary — leaving it open would let an attacker front-run
  it to capture a token's payouts (#1278). A deposit whose `beneficiary` mismatches
  an existing escrow's reverts rather than silently routing to the stored one.
- **Freeze/Unfreeze** — Admin freezes during disputes
- **Release** — Permissionless after escrow period (anyone can call)
- **Redirect** — Admin sends frozen funds to rightful owner on confirmed theft

> **Deploy/ops:** after deploying `RevenueEscrow`, allowlist the revenue-routing
> address with `setDepositor(router, true)` (the owner is implicitly authorized).

```solidity
// Authorize the revenue router once (owner only)
escrow.setDepositor(revenueRouter, true);

// Deposit revenue (owner or an authorized depositor)
escrow.deposit{value: salePrice}(tokenId, artistAddress);

// Freeze during dispute
escrow.freeze(tokenId);

// Release after escrow period (permissionless)
escrow.release(tokenId);

// Redirect to rightful owner
escrow.redirect(tokenId, rightfulOwner);
```

### ShowCampaignEscrow.sol

Purpose-built escrow for Resonate Shows. Unlike `RevenueEscrow`, which holds
post-sale creator earnings per token, show campaigns need campaign-level
thresholds, unique backer counts, public refund paths, and release gates tied to
booking and fulfillment evidence.

Core behavior:

- owner creates a campaign with an artist authority hash, beneficiary,
  stablecoin payment token, goal, minimum backers, deadline, booking deadline,
  optional deposit release bps, and dispute window. Creation validates
  `minimumBackers >= 1` and `MIN_DISPUTE_WINDOW (1h) <= disputeWindow <=
  MAX_DISPUTE_WINDOW (90d)` — a zero window would remove the backer contest
  period and a near-`uint256` window would overflow-brick `releaseFunds` (#1277);
- owner activates draft campaigns after backend artist-authority review;
- fans pledge ERC-20 funds while the campaign is active;
- reaching the goal and minimum backer threshold marks the campaign `Funded`
  but does not release funds;
- anyone can open refunds when an active campaign misses its deadline or a
  funded campaign misses its booking deadline;
- **anyone can also open refunds when a confirmed booking misses its fulfillment
  deadline** (`openRefundsAfterMissedFulfillment`, issue #1271 / SCE-1). Booking
  confirmation snapshots `fulfillmentDeadline = block.timestamp +
  fulfillmentWindow`; once it passes, a stalled `BookingConfirmed` or
  `DepositReleased` campaign can be forced to `RefundAvailable` by any caller, so
  backers are never trapped if the operator's confirmer keys **and** the ops owner
  both go silent after booking. The window is a global, owner-tunable value
  (`setFulfillmentWindow`, bounded `MIN_FULFILLMENT_WINDOW (1d) …
  MAX_FULFILLMENT_WINDOW (180d)`) — **not** a `createCampaign` parameter, so the
  creation ABI is unchanged. It is inert while `fulfillmentWindow == 0` (the
  deadline stays 0 and the escape reverts `FulfillmentDeadlineNotPassed`).
  Campaigns already in `BookingConfirmed`/`DepositReleased` at the 2.1.0 upgrade
  carry `fulfillmentDeadline == 0` and are **not** retro-covered (they remain
  governed by the owner/confirmer exits); this is accepted, not backfilled. From
  `DepositReleased`, `claimRefund` distributes only the un-released remainder
  (`totalPledged − totalReleased`), so the released deposit stays with the artist;
- owner or authorized confirmers can confirm booking and fulfillment;
- optional deposit release is capped at 30% and only available after booking
  confirmation when disclosed in campaign terms;
- final release is permissionless after fulfillment and the dispute window;
- the owner can cancel a campaign that stalls after an early deposit release, or a
  fulfilled one **only while its dispute window is still open** — once the window
  closes the payout has matured and `releaseFunds` is permissionless, so the owner
  can no longer divert an already-claimable artist payout back to refunds
  (`cancelCampaign` reverts `DisputeWindowClosed`);
- backers then claim their **pro-rata share of the remaining (outstanding)
  balance** — `pledge × (totalPledged − totalReleased) / totalPledged` — so an
  early deposit payout can never strand the rest of the funds (#1276). With no
  deposit released this equals each backer's full pledge. The `refundable(id,
  backer)` view returns this same claimable amount, so it never overstates what a
  backer will actually receive.

```solidity
uint256 campaignId = showEscrow.createCampaign(
    artistIdHash,
    authorityHash,
    artistBeneficiary,
    usdc,
    100_000e6,
    500,
    block.timestamp + 14 days,
    block.timestamp + 30 days,
    0,
    7 days
);

showEscrow.activateCampaign(campaignId);
showEscrow.pledge(campaignId, 75e6);

// Later, after the threshold is met:
showEscrow.confirmBooking(campaignId);
showEscrow.confirmFulfillment(campaignId);
showEscrow.releaseFunds(campaignId);
```

## Deployment

See also: [contracts/README.md](../../contracts/README.md) for detailed env vars and cast commands.

```bash
# Deploy to local
forge script script/DeployProtocol.s.sol --rpc-url http://localhost:8545 --broadcast

# Deploy to Base Sepolia
forge script script/DeployProtocol.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify
```

## Integration

### Frontend (viem/wagmi)

```typescript
import {
  StemNFTABI,
  StemMarketplaceABI,
  getAddresses,
} from "@resonate/contracts/abi";
import { useReadContract, useWriteContract } from "wagmi";

// Get stem info
const { data: stem } = useReadContract({
  address: getAddresses(chainId).stemNFT,
  abi: StemNFTABI,
  functionName: "stems",
  args: [tokenId],
});

// Mint a stem
const { writeContract } = useWriteContract();
writeContract({
  address: getAddresses(chainId).stemNFT,
  abi: StemNFTABI,
  functionName: "mint",
  args: [
    to,
    amount,
    tokenURI,
    royaltyReceiver,
    royaltyBps,
    remixable,
    parentIds,
  ],
});
```

### Backend (viem)

```typescript
import { createPublicClient, http } from "viem";
import { StemNFTABI, getAddresses } from "@resonate/contracts/abi";

const client = createPublicClient({ transport: http(rpcUrl) });

// Read stem data
const stem = await client.readContract({
  address: getAddresses(chainId).stemNFT,
  abi: StemNFTABI,
  functionName: "stems",
  args: [tokenId],
});
```

## Testing

```bash
# All tests
forge test

# Coverage
forge coverage --report summary

# Fuzz tests (more runs)
forge test --match-path "test/fuzz/*" --fuzz-runs 1024

# Invariant tests (more runs)
forge test --match-path "test/invariant/*" --invariant-runs 256

# Symbolic/formal tests written in Foundry style for Halmos
halmos --contract StemNFTFormalTest
halmos --contract ShowCampaignEscrowFormalTest

# Certora Prover specs
certoraRun certora/conf/show_campaign_escrow.conf

# Mutation testing for high-value contracts/specs
# Configure Gambit per target before running it in CI.
gambit --help
```

For material contract changes, Resonate expects a risk-scaled test ladder:

- unit tests for all expected transitions and access-control failures;
- Foundry fuzz/property tests for numeric bounds, authorization branching,
  accounting, transfers, mint/list/buy flows, and non-trivial inputs;
- Foundry invariant tests for escrow, marketplace, token-supply, role, and
  multi-step lifecycle behavior;
- symbolic/formal tests with maintained tools such as Halmos, Kontrol, or
  Certora for critical custody, accounting, authorization, or upgrade
  properties, or an explicit documented deferral.
- mutation testing with Certora Gambit for high-value contracts/specs when we
  need evidence that tests or formal rules catch intentionally injected faults.

Shared contract surfaces such as events, errors, enums, and structs should live
in interfaces under `contracts/src/interfaces/` so tests and production code do
not duplicate declarations. Custom errors should include identifying parameters
when they materially improve debugging, for example campaign id, caller,
expected/current status, or requested/max basis points.

Certora Prover specs use the `contracts/certora/conf/` and
`contracts/certora/specs/` layout. Use that layer for high-value custody,
accounting, authorization, upgrade, and state-machine properties; use Gambit to
evaluate whether those specs or the Solidity tests kill meaningful mutants.

## Gas Estimates

| Operation          | Gas   |
| ------------------ | ----- |
| Mint original stem | ~200k |
| Mint remix         | ~220k |
| List for sale      | ~155k |
| Buy from listing   | ~325k |
| Attest content     | ~120k |
| Stake (deposit)    | ~75k  |
| Slash              | ~110k |
| Escrow deposit     | ~80k  |
| Escrow release     | ~45k  |

## Security Considerations

1. **Royalty cap** - Marketplace caps royalties at 25% to prevent griefing
2. **Protocol fee cap** - Max 5% protocol fee
3. **Reentrancy** - ReentrancyGuard on all payout functions (slash, refund, release, redirect)
4. **CEI pattern** - All contracts follow Checks-Effects-Interactions
5. **Access control** - Role-based permissions for admin functions
6. **Transfer validation** - Whitelist + blacklist enforcement
7. **UUPS upgrade safety** - Only owner can authorize ContentProtection upgrades
8. **Blacklist propagation** - TransferValidator checks ContentProtection blacklist on every transfer
9. **Stake-to-price cap** - `PriceExceedsStakeCap` revert prevents listings with price > `stake × maxPriceMultiplier`
10. **Upgrade continuity** - `reinitializeV2()` seeds `maxPriceMultiplier = 10` on existing deployments via UUPS upgrade
11. **Fee-on-transfer rejection** - Every ERC-20 intake (pledge, deposit, stake, marketplace payment) measures the received `balanceOf` delta and reverts `FeeOnTransferNotSupported` if it differs from the requested amount, so fee-on-transfer / rebasing tokens cannot corrupt per-token accounting (#1285). Custody contracts assume standard, non-fee, non-rebasing ERC-20s.
12. **Push-then-escrow payouts** - RevenueEscrow, StemMarketplaceV2, and ContentProtection attempt each payout directly but, if the recipient reverts (a contract that rejects ETH — e.g. a creator-controlled royalty receiver — or a token that blocklists the address), escrow the funds in `failedPayments[token][recipient]` (emitting `PaymentEscrowed`) instead of reverting the whole release / sale / slash. Recipients reclaim via `claimFailedPayment(token)`, so a reverting recipient cannot grief the operation (#1287).
13. **Buy-time re-validation** - `buy` rejects zero-amount fills (#1284) and re-checks the seller still holds (`balanceOf >= amount`) and has approved the marketplace before taking payment, so a stale listing (seller exited the position) fails early with a clear error rather than relying on the final transfer to revert (#1283). Listings persist across balance changes — a seller who exits should cancel.
