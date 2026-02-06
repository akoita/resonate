# Marketplace Integration

Frontend and backend integration for the Stem NFT marketplace.

## Frontend Pages

| Route | Description |
|-------|-------------|
| `/marketplace` | Browse and purchase stem NFT listings |
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

| Endpoint | Description |
|----------|-------------|
| `GET /api/metadata/:chainId/:tokenId` | ERC-1155 token metadata |
| `GET /api/metadata/listings` | Active marketplace listings |
| `GET /api/metadata/earnings/:address` | Artist royalty earnings |

## Environment Variables

```bash
# Contract Addresses (set after deployment)
LOCAL_STEM_NFT_ADDRESS=0x...
LOCAL_MARKETPLACE_ADDRESS=0x...
SEPOLIA_STEM_NFT_ADDRESS=0x...
SEPOLIA_MARKETPLACE_ADDRESS=0x...

# Indexer
ENABLE_CONTRACT_INDEXER=true
LOCAL_RPC_URL=http://localhost:8545

# ZeroDev (frontend)
NEXT_PUBLIC_ZERODEV_PROJECT_ID=your-project-id
```

## Frontend Hooks

```typescript
import { useMintStem, useListStem, useBuyQuote } from '@/hooks/useContracts';

// Mint a new stem
const { mint, loading } = useMintStem();
await mint({ amount: 10, royaltyBps: 500, remixable: true, parentIds: [] });

// List for sale
const { list } = useListStem();
await list({ tokenId, amount: 5, pricePerUnit: parseEther('0.01'), duration: 7 * 24 * 3600 });
```

See [Core Contracts](./phase5/core_contracts.md) for Solidity details.
