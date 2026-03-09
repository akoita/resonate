# Resonate Protocol — Smart Contracts

Solidity contracts powering the Resonate music platform: NFT stems, marketplace, content protection, and revenue escrow.

> **Full documentation:** [`docs/smart-contracts/`](../docs/smart-contracts/) — architecture, code examples, integration patterns, gas estimates, security considerations.

## Contracts

| Contract              | File                                | Description                                                 |
| --------------------- | ----------------------------------- | ----------------------------------------------------------- |
| **StemNFT**           | `src/core/StemNFT.sol`              | ERC-1155 NFT for music stems. Gates minting on attestation. |
| **StemMarketplaceV2** | `src/core/StemMarketplaceV2.sol`    | List / buy / resale with protocol fees.                     |
| **ContentProtection** | `src/core/ContentProtection.sol`    | UUPS proxy. Attest, stake, slash (60/30/10), blacklist.     |
| **RevenueEscrow**     | `src/core/RevenueEscrow.sol`        | Per-token escrow. Deposit, freeze, release, redirect.       |
| **TransferValidator** | `src/modules/TransferValidator.sol` | Transfer hook: whitelist + blacklist enforcement.           |

## Deployment

### Prerequisites

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd contracts && forge install
```

### Local (Anvil)

```bash
# 1. Start local node
anvil

# 2. Deploy AA infrastructure (EntryPoint + Kernel) — only needed once
forge script script/DeployLocalAA.s.sol --rpc-url http://localhost:8545 --broadcast

# 3. Deploy protocol contracts
forge script script/DeployProtocol.s.sol --rpc-url http://localhost:8545 --broadcast

# 4. Note the printed addresses and update:
#    - web/src/contracts_abi/index.ts  → ADDRESSES.contentProtection
#    - backend/.env                    → if indexer needs contract addresses
```

### Testnet / Mainnet

```bash
export PRIVATE_KEY=0x...
export RPC_URL=https://...
export ETHERSCAN_API_KEY=...

# Optional overrides (defaults shown)
export STAKE_AMOUNT=10000000000000000   # 0.01 ETH in wei
export ESCROW_PERIOD=2592000            # 30 days in seconds
export PROTOCOL_FEE_BPS=250            # 2.5%

forge script script/DeployProtocol.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify
```

### Deployment Order (automated by script)

1. **TransferValidator** — standalone module
2. **ContentProtection** — UUPS proxy (implementation + ERC1967Proxy)
3. **RevenueEscrow** — initialized with owner + escrow period
4. **StemNFT** — core NFT contract
5. **StemMarketplaceV2** — linked to StemNFT
6. **Configure:**
   - `stemNFT.setTransferValidator(validator)`
   - `stemNFT.setContentProtection(contentProtection)`
   - `validator.setWhitelist(marketplace, true)`
   - `validator.setContentProtection(contentProtection)`

### Deploy Scripts

| Script                          | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `DeployProtocol.s.sol`          | Full protocol from scratch (NFT + Marketplace + Protection + Escrow) |
| `DeployContentProtection.s.sol` | Phase 2 only — add ContentProtection + Escrow to existing deployment |
| `DeployLocalAA.s.sol`           | ERC-4337 Account Abstraction infra (EntryPoint, Kernel, Factory)     |

### Add to Existing Deployment (Phase 2 only)

If you already have StemNFT + TransferValidator deployed, use this to add only the new contracts:

```bash
export STEM_NFT_ADDRESS=0x...              # Your existing StemNFT
export TRANSFER_VALIDATOR_ADDRESS=0x...    # Your existing TransferValidator

forge script script/DeployContentProtection.s.sol \
  --rpc-url $RPC_URL --broadcast --verify
```

This will:

1. Deploy ContentProtection (UUPS proxy)
2. Deploy RevenueEscrow
3. Link both to your existing StemNFT and TransferValidator

### Environment Variables

| Variable           | Default                             | Description                           |
| ------------------ | ----------------------------------- | ------------------------------------- |
| `PRIVATE_KEY`      | Anvil key #0                        | Deployer private key                  |
| `BASE_URI`         | `https://api.resonate.fm/metadata/` | NFT metadata base URI                 |
| `FEE_RECIPIENT`    | Deployer address                    | Protocol fee + treasury recipient     |
| `PROTOCOL_FEE_BPS` | `250` (2.5%)                        | Marketplace fee in basis points       |
| `STAKE_AMOUNT`     | `0.01 ether`                        | Default stake amount for new creators |
| `ESCROW_PERIOD`    | `30 days`                           | Default escrow hold duration          |

### Post-Deploy Checklist

- [ ] Update `web/src/contracts_abi/index.ts` with new addresses for your chain ID
- [ ] Update backend `.env` with contract addresses (if indexer needs them)
- [ ] Verify contracts on block explorer (if `--verify` wasn't used)
- [ ] Test attestation + staking flow end-to-end

## Testing

```bash
forge test                                      # All tests
forge test --match-path test/ContentProtection.t.sol -vvv  # Specific file
forge test --gas-report                         # With gas report
```

## Admin Operations (cast)

```bash
# Check attestation / stake / blacklist
cast call $CONTENT_PROTECTION "isAttested(uint256)(bool)" 1 --rpc-url $RPC_URL
cast call $CONTENT_PROTECTION "isStaked(uint256)(bool)" 1 --rpc-url $RPC_URL
cast call $CONTENT_PROTECTION "isBlacklisted(address)(bool)" 0x... --rpc-url $RPC_URL

# Slash (admin) — 60% reporter, 30% treasury, 10% burned
cast send $CONTENT_PROTECTION "slash(uint256,address)" 1 $REPORTER \
  --private-key $PRIVATE_KEY --rpc-url $RPC_URL

# Refund stake (admin)
cast send $CONTENT_PROTECTION "refundStake(uint256)" 1 \
  --private-key $PRIVATE_KEY --rpc-url $RPC_URL

# Freeze / redirect escrow (admin)
cast send $REVENUE_ESCROW "freeze(uint256)" 1 --private-key $PRIVATE_KEY --rpc-url $RPC_URL
cast send $REVENUE_ESCROW "redirect(uint256,address)" 1 $RIGHTFUL_OWNER \
  --private-key $PRIVATE_KEY --rpc-url $RPC_URL

# Release escrow (permissionless, after period)
cast send $REVENUE_ESCROW "release(uint256)" 1 --rpc-url $RPC_URL
```

## Upgradeability

**ContentProtection** uses the UUPS proxy pattern (OpenZeppelin). Only the owner can authorize upgrades via `_authorizeUpgrade()`.

```solidity
ContentProtection newImpl = new ContentProtection();
contentProtection.upgradeToAndCall(address(newImpl), "");
```
