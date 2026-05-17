# Marketplace Integration

Frontend and backend integration for the Stem NFT marketplace.

## Frontend Pages

| Route             | Description                                      |
| ----------------- | ------------------------------------------------ |
| `/marketplace`    | Browse and purchase stem NFT listings through x402 or direct on-chain rails |
| `/stem/[tokenId]` | View stem metadata, royalties, and remix lineage |

## Backend Services

### Event Indexer

`backend/src/modules/contracts/indexer.service.ts`

Polls blockchain for contract events and stores in database:

- `StemMinted` → Creates `StemNftMint` record
- `Listed` / `Cancelled` → Updates `StemListing`
- `Sold` → Creates `StemPurchase`
- `RoyaltyPaid` → Creates `RoyaltyPayment`

### Metadata API

`backend/src/modules/contracts/metadata.controller.ts`

| Endpoint                              | Description                 |
| ------------------------------------- | --------------------------- |
| `GET /api/metadata/:chainId/:tokenId` | ERC-1155 token metadata     |
| `GET /api/metadata/listings`          | Active marketplace listings, including `paymentToken` for stablecoin/ERC-20 display |
| `GET /api/metadata/earnings/:address` | Artist royalty earnings     |

## Environment Variables

```bash
# Contract Addresses (set by contracts/scripts/update-protocol-config.sh)
STEM_NFT_ADDRESS=0x...
MARKETPLACE_ADDRESS=0x...
TRANSFER_VALIDATOR_ADDRESS=0x...

# Indexer
ENABLE_CONTRACT_INDEXER=true
RPC_URL=http://localhost:8545
```

## Agent Purchase Integration

The AI agent prioritizes tracks with active marketplace listings for real on-chain purchases:

1. `catalog.search` annotates results with `hasListing` flag; listed tracks are sorted first
2. Selector and Vertex AI system prompt prefer `hasListing=true` tracks
3. Negotiator queries `StemListing` for active on-chain listings
4. `recordPurchase` does a fallback listing lookup if the runtime adapter didn't provide one
5. If listing exists → `AgentPurchaseService.purchase()` submits a real UserOp
6. If no listing → falls back to mock transaction record
7. Agent purchases always use session-key-scoped UserOps through the bundler

## Frontend Hooks

Creator listing surfaces default to the configured marketplace stablecoin asset
when one is available. `ListStemModal`, `MintStemButton`, and
`BatchMintListModal` all resolve the default listing asset from `/payments/assets`
and convert the creator-facing decimal price into that asset's units before
calling `StemMarketplaceV2.list` or `listLastMint`. If no configured stablecoin
marketplace asset exists, they fall back to native-token listings for local and
legacy deployments.

The direct on-chain buy path reads each listing's `paymentToken`. Native-token
listings send value with the marketplace purchase call. ERC-20 listings batch a
token approval and marketplace purchase in one smart-account operation. The
transaction shape is planned in `web/src/lib/onchainCheckout.ts`, so a USDC
listing remains a stablecoin purchase even though it uses the on-chain wallet
transaction rail.

The x402 rail records a durable `X402Settlement` row for paid downloads and
links the receipt to the active marketplace listing when one exists. Until x402
redemption executes or proves the marketplace contract purchase, those receipts
use `settlement.status = "contract_required_missing"` rather than claiming the
same ownership state as a direct `StemMarketplaceV2.buy`.

`StemMarketplaceV2` also exposes `buyFor(listingId, amount, recipient)` for
server-mediated rails such as x402. The original `buy(listingId, amount)` keeps
transferring ownership to `msg.sender`; `buyFor` collects payment from
`msg.sender` but transfers the purchased ERC-1155 stem units to `recipient` and
emits `Sold(listingId, recipient, amount, totalPaid)`. When
`X402_CONTRACT_SETTLEMENT_ENABLED=true`, the backend verifies the x402 payment,
requires `X-Resonate-Buyer` or `?buyer=`, approves the listing payment token
from the payout wallet, calls `buyFor`, waits for `Sold`, and only then serves
the paid stem with `settlement.status = "contract_backed"`.

```typescript
import { useMintStem, useListStem, useBuyQuote } from "@/hooks/useContracts";

// Mint a new stem
const { mint, loading } = useMintStem();
await mint({ amount: 10, royaltyBps: 500, remixable: true, parentIds: [] });

// List for sale
const { list } = useListStem();
await list({
  tokenId,
  amount: 5,
  pricePerUnit: parseEther("0.01"),
  duration: 7 * 24 * 3600,
});
```

See [Core Contracts](core_contracts.md) for Solidity details.
