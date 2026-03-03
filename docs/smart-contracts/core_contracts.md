# Core Smart Contracts

## Overview

The Resonate Protocol core contracts implement:
- **Stem NFTs** (ERC-1155) with remix lineage tracking
- **Enforced royalties** via EIP-2981 + marketplace enforcement
- **Transfer validation** for royalty-compliant transfers
- **0xSplits integration** for revenue distribution

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      CORE (Required)                            │
├─────────────────────────────────────────────────────────────────┤
│  StemNFT.sol          │  StemMarketplaceV2.sol                  │
│  - ERC1155 + EIP-2981 │  - Listings/Offers                      │
│  - Remix lineage      │  - Enforced royalties                   │
│  - Validator hook     │  - Routes to 0xSplits                   │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│                    MODULES (Optional)                           │
├─────────────────────────────────────────────────────────────────┤
│  TransferValidator.sol│  0xSplits (external)                    │
│  - Whitelist logic    │  - Revenue splitting                    │
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

```solidity
// List stems for sale
uint256 listingId = marketplace.list(
    tokenId,        // stem to sell
    amount,         // quantity
    pricePerUnit,   // ETH price per unit
    address(0),     // payment token (0 = ETH)
    7 days          // duration
);

// Buy from listing (royalties enforced automatically)
marketplace.buy{value: totalPrice}(listingId, buyAmount);
```

### TransferValidator.sol

Optional module to whitelist royalty-compliant operators:
- Whitelist trusted marketplaces
- Allow/block direct transfers
- Plugs into StemNFT's transfer hook

```solidity
// Admin whitelists marketplace
validator.setWhitelist(address(marketplace), true);

// Connect to StemNFT
stemNFT.setTransferValidator(address(validator));
```

## Deployment

```bash
# Deploy to local
forge script script/DeployProtocol.s.sol --rpc-url http://localhost:8545 --broadcast

# Deploy to Base Sepolia
forge script script/DeployProtocol.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify
```

## Integration

### Frontend (viem/wagmi)

```typescript
import { StemNFTABI, StemMarketplaceABI, getAddresses } from '@resonate/contracts/abi';
import { useReadContract, useWriteContract } from 'wagmi';

// Get stem info
const { data: stem } = useReadContract({
  address: getAddresses(chainId).stemNFT,
  abi: StemNFTABI,
  functionName: 'stems',
  args: [tokenId],
});

// Mint a stem
const { writeContract } = useWriteContract();
writeContract({
  address: getAddresses(chainId).stemNFT,
  abi: StemNFTABI,
  functionName: 'mint',
  args: [to, amount, tokenURI, royaltyReceiver, royaltyBps, remixable, parentIds],
});
```

### Backend (viem)

```typescript
import { createPublicClient, http } from 'viem';
import { StemNFTABI, getAddresses } from '@resonate/contracts/abi';

const client = createPublicClient({ transport: http(rpcUrl) });

// Read stem data
const stem = await client.readContract({
  address: getAddresses(chainId).stemNFT,
  abi: StemNFTABI,
  functionName: 'stems',
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
```

## Gas Estimates

| Operation | Gas |
|-----------|-----|
| Mint original stem | ~200k |
| Mint remix | ~220k |
| List for sale | ~155k |
| Buy from listing | ~325k |

## Security Considerations

1. **Royalty cap** - Marketplace caps royalties at 25% to prevent griefing
2. **Protocol fee cap** - Max 5% protocol fee
3. **Reentrancy** - Uses transient storage (EIP-1153) for reentrancy guards
4. **Access control** - Role-based permissions for admin functions
5. **Transfer validation** - Optional whitelist enforcement
