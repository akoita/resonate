# Marketplace Integration

Frontend and backend integration for the Stem NFT marketplace.

## Frontend Pages

| Route             | Description                                      |
| ----------------- | ------------------------------------------------ |
| `/marketplace`    | Browse and purchase stem NFT listings            |
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
| `GET /api/metadata/listings`          | Active marketplace listings |
| `GET /api/metadata/earnings/:address` | Artist royalty earnings     |

## Environment Variables

```bash
# Contract Addresses (set by scripts/update-protocol-config.sh)
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
7. When `AA_SKIP_BUNDLER=true` → all purchases are mock (shown as MOCK in the UI)

## Frontend Hooks

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
