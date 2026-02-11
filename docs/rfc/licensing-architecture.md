---
title: "RFC: Comprehensive Licensing Architecture for IP Management"
status: draft
author: "@akoita"
issue: "#310"
created: "2026-02-11"
---

# RFC: Comprehensive Licensing Architecture for IP Management

## Abstract

This RFC defines a comprehensive licensing architecture for the Resonate protocol, covering the full spectrum of IP rights management for music stems. It establishes the on-chain license metadata standard, enforcement layers, smart contract interfaces, and edge case handling required to support real-world music IP transactions at scale.

## Motivation

Resonate's current implementation handles three basic pricing tiers (Personal, Remix, Commercial) via `StemPricing` in the backend. However, real-world music IP management is significantly more complex. Artists need granular control over usage rights, buyers need verifiable proof of licensing, and the platform needs automated enforcement across both on-chain and off-chain contexts.

This RFC provides the foundational design that enables:

- **#311** — Buyer-Facing Licensing UI
- **#309** — Recursive Remix Royalties
- **#285** — Edition Strategy Configuration

---

## 1. Rights Matrix

The full spectrum of usage rights available for stems on Resonate:

| Right          | Description                                     | Enforcement                         | Exclusivity                | Duration                     |
| -------------- | ----------------------------------------------- | ----------------------------------- | -------------------------- | ---------------------------- |
| **Personal**   | Streaming / personal listening within a session | Platform-gated (encrypted playback) | Non-exclusive              | Session-based                |
| **Remix**      | Use stem in derivative works, publish remixes   | License NFT + on-chain provenance   | Non-exclusive by default   | Perpetual or time-limited    |
| **Commercial** | Use in ads, films, products, monetized content  | License NFT + legal covenant        | Exclusive or non-exclusive | Fixed term (e.g., 12 months) |
| **Sync**       | Synchronization with video/media content        | License NFT + negotiated terms      | Exclusive or non-exclusive | Per-project or fixed term    |
| **Sample**     | Short excerpt usage (< 30 seconds)              | License NFT + attribution           | Non-exclusive              | Perpetual                    |
| **Derivative** | Any modification of the original work           | Covered by Remix + ancestry chain   | Non-exclusive              | Follows parent license       |
| **Broadcast**  | Radio, podcast, live streaming usage            | License NFT + reporting obligations | Non-exclusive              | Annual renewable             |

### Right Hierarchy

```
Personal (base) ⊂ Sample ⊂ Remix ⊂ Commercial ⊂ Sync
                                                    │
                                              Broadcast (parallel)
```

A Commercial license implicitly grants Remix and Personal rights. A Sync license is the most permissive and includes all other rights.

---

## 2. License Structure

Each license issued on Resonate encodes the following properties:

### 2.1 Core Fields

| Field         | Type    | Description                                                      |
| ------------- | ------- | ---------------------------------------------------------------- |
| `licenseType` | enum    | `personal`, `remix`, `commercial`, `sync`, `sample`, `broadcast` |
| `stemId`      | uint256 | On-chain token ID of the licensed stem                           |
| `grantee`     | address | Wallet address of the license holder                             |
| `grantor`     | address | Wallet address of the rights holder (artist/creator)             |
| `issuedAt`    | uint256 | Timestamp of license issuance                                    |

### 2.2 Terms

| Field                 | Type    | Description                                    | Default             |
| --------------------- | ------- | ---------------------------------------------- | ------------------- |
| `exclusive`           | bool    | Exclusive vs. non-exclusive grant              | `false`             |
| `territory`           | string  | Geographic restriction                         | `"worldwide"`       |
| `duration`            | uint256 | License duration in seconds (`0` = perpetual)  | `0`                 |
| `attribution`         | string  | Required credit terms                          | `"Credit required"` |
| `royaltyBps`          | uint16  | Ongoing royalty percentage in basis points     | `500` (5%)          |
| `ancestryDecayFactor` | uint8   | Decay factor for recursive remix royalties (%) | `50`                |
| `modificationRights`  | enum    | `none`, `remix_only`, `full`                   | `remix_only`        |
| `sublicensable`       | bool    | Can the licensee grant rights to others?       | `false`             |

### 2.3 Covenants

Legal covenant URIs attached to the license, stored as an array of IPFS CIDs or URLs pointing to human-readable legal terms.

### 2.4 Ancestry

| Field             | Type      | Description                                     |
| ----------------- | --------- | ----------------------------------------------- |
| `parentLicenseId` | uint256   | License ID of the parent (for derivative works) |
| `parentStemIds`   | uint256[] | Source stem token IDs used in the derivative    |
| `ancestryDepth`   | uint8     | Depth in the remix tree (0 = original)          |

---

## 3. On-Chain License NFT Standard

Licenses are minted as ERC-1155 tokens via the `LicenseRegistry` contract. Each License NFT has metadata conforming to the schema defined in [license-nft-schema.json](./license-nft-schema.json).

### 3.1 Metadata Example

```json
{
  "name": "Remix License — Billie Jean (Bass Stem)",
  "description": "Non-exclusive remix license for stem #42",
  "image": "ipfs://Qm.../license-badge.png",
  "licenseType": "remix",
  "stemTokenId": 42,
  "grantee": "0xBuyer...",
  "grantor": "0xArtist...",
  "terms": {
    "exclusive": false,
    "territory": "worldwide",
    "duration": 0,
    "attribution": "Credit: Michael Jackson — Billie Jean",
    "royaltyBps": 500,
    "ancestryDecayFactor": 50,
    "modificationRights": "remix_only",
    "sublicensable": false
  },
  "covenants": ["ipfs://Qm.../remix-license-v1.pdf"],
  "issuedAt": "2026-02-11T00:00:00Z",
  "parentLicenseId": null,
  "parentStemIds": [42],
  "ancestryDepth": 0
}
```

### 3.2 Token URI Resolution

License NFT metadata is stored on IPFS. The `LicenseRegistry` contract stores the IPFS CID and resolves it via `tokenURI(tokenId)`. Metadata is immutable once minted — license amendments require minting a new License NFT and revoking the old one.

### 3.3 Soulbound vs. Transferable

| License Type | Transferable?      | Rationale                                      |
| ------------ | ------------------ | ---------------------------------------------- |
| Personal     | No (soulbound)     | Tied to session/user, no resale value          |
| Remix        | Yes (transferable) | Producer may sell project including licenses   |
| Commercial   | Conditional        | Transferable only if terms allow sub-licensing |
| Sync         | No (soulbound)     | Project-specific, non-transferable             |
| Sample       | Yes (transferable) | Low-value, frictionless transfer               |
| Broadcast    | No (soulbound)     | Tied to broadcaster identity                   |

---

## 4. Enforcement Layers

### 4.1 Layer Summary

| Layer                  | Coverage                 | Status             | Enforcement Mechanism                                          |
| ---------------------- | ------------------------ | ------------------ | -------------------------------------------------------------- |
| Platform encryption    | Personal access          | ✅ Built           | AES-256-GCM encrypted stems, decryption key gated by ownership |
| Smart contract splits  | On-platform royalties    | ✅ Built           | `StemMarketplaceV2` + EIP-2981 + 0xSplits                      |
| License NFT provenance | On-chain proof of rights | 🔧 To build        | `LicenseRegistry` mints license tokens on purchase             |
| Ancestry tracking      | Remix lineage            | 🔧 Partially built | `StemNFT.parentIds[]` exists; needs `AncestryTracker`          |
| Multi-gen royalties    | Recursive remix payouts  | 📋 Planned (#309)  | `RoyaltySplitter` walks ancestry chain                         |
| Audio fingerprinting   | Detect unlicensed usage  | 📋 Future          | Chromaprint / Dejavu integration                               |
| Legal covenants        | Off-platform enforcement | 📋 To build        | IPFS-stored legal terms attached to License NFTs               |
| DMCA tooling           | Takedown automation      | 📋 Future          | Automated DMCA notice generation from fingerprint matches      |

### 4.2 On-Platform Enforcement Flow

```
Purchase Request
       │
       ▼
┌─────────────────────┐
│  Verify Payment     │──── Insufficient? → Revert
│  (ETH / ERC-20)     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Mint License NFT   │──── LicenseRegistry.mintLicense(...)
│  (on-chain record)  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Split Payment      │──── Walk ancestry chain
│  (RoyaltySplitter)  │──── Distribute to all ancestors
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Grant Access       │──── Decrypt stem for licensee
│  (Platform layer)   │──── Record in backend License table
└─────────────────────┘
```

### 4.3 Off-Platform Enforcement

Off-platform usage (e.g., a remix uploaded to Spotify) is enforced via:

1. **Legal covenants** attached to the License NFT (IPFS-stored PDF/markdown)
2. **Audio fingerprinting** (future) to detect unlicensed usage on external platforms
3. **DMCA tooling** (future) to automate takedown notices

The License NFT serves as verifiable proof of rights in any dispute.

---

## 5. Edge Cases

### 5.1 Non-Exclusive Concurrency

**Scenario:** A stem is used in multiple remixes simultaneously.

**Resolution:** Non-exclusive licenses are the default. Multiple licensees can hold concurrent remix licenses for the same stem. Each remix triggers independent royalty flows to the original creator.

### 5.2 Exclusive License Revocation

**Scenario:** An exclusive license is revoked — what happens to existing remixes?

**Resolution:**

- Existing remixes created _before_ revocation retain their rights (grandfathered)
- No new licenses can be issued while an exclusive license is active
- Revocation unlocks the stem for new non-exclusive licensing
- `LicenseRegistry` emits `LicenseRevoked(licenseId)` event

### 5.3 License Expiration

**Scenario:** A time-limited remix license expires — does the remix get delisted?

**Resolution:**

- Expired licenses stop generating royalties for the licensor
- The remix itself remains on-chain (cannot delete on-chain data)
- Platform can choose to delist or flag expired-license remixes in the UI
- Grace period of 30 days for renewal before delisting

### 5.4 Disputed Ownership

**Scenario:** Two artists claim the same stem.

**Resolution:**

- Only the wallet that minted the `StemNFT` can issue licenses
- Disputes are handled off-chain (platform moderation + DMCA process)
- `StemNFT.getCreator(tokenId)` provides authoritative on-chain proof
- Future: integrate with audio fingerprinting to detect duplicate uploads

### 5.5 Cross-Platform Licensing

**Scenario:** A stem licensed on Resonate is used on another platform.

**Resolution:**

- License NFT metadata is publicly readable on-chain
- External platforms can verify license status via `LicenseRegistry.isValidLicense(licenseId)`
- Legal covenants define cross-platform usage rights
- Audio fingerprinting (future) enables cross-platform monitoring

### 5.6 AI-Generated Derivatives

**Scenario:** An AI model generates a remix using licensed stems.

**Resolution:**

- AI-generated derivatives are treated identically to human remixes
- The account that triggers the AI generation holds the license
- Ancestry tracking records the AI remix as a child of the source stems
- Same royalty obligations apply (no AI discount)

### 5.7 Collaborative Stems

**Scenario:** Multiple contributors to a single stem, split ownership.

**Resolution:**

- Use 0xSplits as the `royaltyReceiver` on the `StemNFT`
- All contributors are encoded in the split configuration
- License revenue automatically distributes to all contributors
- Any contributor with the `MINTER_ROLE` can manage the stem

### 5.8 License Transfer

**Scenario:** A licensee wants to sell/transfer their license to another party.

**Resolution:**

- Transferable licenses (see §3.3) can be transferred via standard ERC-1155 `safeTransferFrom`
- Soulbound licenses use `TransferValidator` to block transfers
- Transfer events are indexed and update the backend `License` table

### 5.9 Blanket Licenses

**Scenario:** A radio station wants to license all stems from an artist for broadcast.

**Resolution:**

- Blanket licenses are modeled as a single License NFT with `stemTokenId: 0` (wildcard)
- `LicenseRegistry.mintBlanketLicense(grantor, grantee, licenseType, terms)`
- Covers all current and future stems by the grantor
- Higher price point, negotiated off-platform, recorded on-chain

---

## 6. Relationship to Existing System

### 6.1 Current State (What Exists)

| Component                 | Status      | Details                                                      |
| ------------------------- | ----------- | ------------------------------------------------------------ |
| `StemNFT` (ERC-1155)      | ✅ Deployed | Supports `parentIds[]`, `remixable` flag, EIP-2981 royalties |
| `StemMarketplaceV2`       | ✅ Deployed | Buy/sell with enforced royalties, listing expiry             |
| `StemPricing` (backend)   | ✅ Built    | Per-stem base, remix, commercial pricing in USD              |
| `License` (Prisma)        | ✅ Built    | Session-based license records (personal/remix/commercial)    |
| `RoyaltyPayment` (Prisma) | ✅ Built    | Indexed on-chain royalty events                              |
| `TransferValidator`       | ✅ Built    | Module for royalty-enforced transfers                        |

### 6.2 What This RFC Adds

| Component          | Type              | Purpose                                      |
| ------------------ | ----------------- | -------------------------------------------- |
| `LicenseRegistry`  | Smart Contract    | Mint/revoke/query License NFTs               |
| `RoyaltySplitter`  | Smart Contract    | Multi-generational royalty distribution      |
| `AncestryTracker`  | Smart Contract    | Deep remix lineage tracking                  |
| License NFT Schema | Metadata Standard | Canonical JSON schema for license metadata   |
| Legal Templates    | Documentation     | Standard covenant templates per license type |

---

## 7. Security Considerations

1. **Reentrancy** — `RoyaltySplitter` performs multiple external calls during distribution; use ReentrancyGuard
2. **Ancestry Depth Limit** — Cap ancestry walks at 10 generations to prevent gas exhaustion
3. **Exclusive Lock** — `LicenseRegistry` must check for active exclusive licenses before minting new ones
4. **Royalty Dust** — Below a threshold (e.g., 0.0001 ETH), dust amounts are aggregated rather than distributed
5. **Front-Running** — Exclusive license minting should use commit-reveal to prevent front-running

---

## References

- [EIP-1155: Multi Token Standard](https://eips.ethereum.org/EIPS/eip-1155)
- [EIP-2981: NFT Royalty Standard](https://eips.ethereum.org/EIPS/eip-2981)
- [0xSplits Protocol](https://splits.org/)
- [Phase 0: Licensing & Pricing Model](../phase0/licensing_pricing_model.md)
- [Issue #309: Recursive Remix Royalties](https://github.com/akoita/resonate/issues/309)
- [Issue #311: Buyer-Facing Licensing UI](https://github.com/akoita/resonate/issues/311)
