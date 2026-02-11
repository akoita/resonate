---
title: "Licensing Architecture — Implementation Roadmap"
status: draft
author: "@akoita"
issue: "#310"
---

# Licensing Architecture — Implementation Roadmap

Phased plan for building out the licensing stack defined in the [Licensing Architecture RFC](./licensing-architecture.md).

---

## Phase 1: License Metadata Extension

**Priority:** P0 — Current Sprint
**Depends on:** Existing `StemNFT`, `StemPricingPanel`, `StemMarketplaceV2`

### Scope

Extend the existing system to surface license types to buyers and record license purchases.

| Task                                                 | Component        | Related Issue |
| ---------------------------------------------------- | ---------------- | ------------- |
| Add `licenseType` field to `StemPurchase` model      | Backend (Prisma) | #311          |
| Surface remix/commercial prices on marketplace cards | Frontend         | #311          |
| License type selector in buy flow                    | Frontend         | #311          |
| Public licensing info section on release detail page | Frontend         | #311          |
| Batch pricing endpoint for marketplace               | Backend          | #311          |

### Deliverables

- Buyers can see and select license types when purchasing stems
- Purchase records include which license type was acquired
- No new smart contracts — uses existing `StemMarketplaceV2`

### Estimated Effort

2-3 sprints (frontend-heavy)

---

## Phase 2: LicenseRegistry Contract

**Priority:** P1 — Next Sprint
**Depends on:** Phase 1, `AncestryTracker`

### Scope

Deploy the `LicenseRegistry` and `AncestryTracker` contracts. Mint License NFTs on purchase.

| Task                                                           | Component           | Related Issue |
| -------------------------------------------------------------- | ------------------- | ------------- |
| Implement `IAncestryTracker` contract                          | Smart Contract      | —             |
| Implement `ILicenseRegistry` contract                          | Smart Contract      | —             |
| Deploy to Sepolia testnet                                      | Infra               | —             |
| Update `IndexerService` to listen for `LicenseMinted` events   | Backend             | —             |
| Update buy flow to mint License NFTs                           | Frontend + Contract | —             |
| License NFT metadata upload to IPFS                            | Backend             | —             |
| License verification endpoint (`GET /api/licenses/:id/verify`) | Backend             | —             |

### Deliverables

- License NFTs minted on-chain for every purchase
- Ancestry tracked for remix mints
- Backend indexes license events
- External platforms can verify licenses on-chain

### Estimated Effort

3-4 sprints (contract-heavy)

---

## Phase 3: Multi-Generational Royalties

**Priority:** P1 — Next Sprint
**Depends on:** Phase 2 (`AncestryTracker`)

### Scope

Deploy the `RoyaltySplitter` contract. Automate recursive royalty distribution through the ancestry chain.

| Task                                              | Component        | Related Issue |
| ------------------------------------------------- | ---------------- | ------------- |
| Implement `IRoyaltySplitter` contract             | Smart Contract   | #309          |
| Add decay factor control to Stem Pricing panel    | Frontend         | #309          |
| `parentStemId` field on `Stem` model              | Backend (Prisma) | #309          |
| Ancestry tree query endpoint                      | Backend          | #309          |
| Royalty flow visualization on stem detail page    | Frontend         | #280          |
| Revenue attribution breakdown in artist dashboard | Frontend         | #281          |

### Deliverables

- Original creators earn diminishing royalties from all downstream remixes
- Artists control decay factor per stem
- Ancestry tree visible on stem detail pages
- Revenue breakdown shows which ancestor stems generated income

### Estimated Effort

3-4 sprints

---

## Phase 4: Exclusive Licensing & Legal Covenants

**Priority:** P2 — Later
**Depends on:** Phase 2 (`LicenseRegistry`)

### Scope

Add exclusive license support and attach legal covenant documents to License NFTs.

| Task                                                | Component          |
| --------------------------------------------------- | ------------------ |
| Exclusive license lockout in `LicenseRegistry`      | Smart Contract     |
| Legal template markdown → IPFS upload pipeline      | Backend            |
| Covenant viewer on license detail page              | Frontend           |
| Exclusive license indicator on marketplace listings | Frontend           |
| License expiration handling + renewal flow          | Frontend + Backend |
| Grace period logic for expired licenses             | Backend            |

### Deliverables

- Artists can issue exclusive licenses that block further licensing
- Legal terms attached to every License NFT as IPFS documents
- License expiration and renewal UX
- Buyers can read exact legal terms before purchasing

### Estimated Effort

2-3 sprints

---

## Phase 5: Cross-Platform Enforcement

**Priority:** P3 — Backlog
**Depends on:** Phase 4

### Scope

Off-platform license enforcement via audio fingerprinting and DMCA tooling.

| Task                                            | Component           |
| ----------------------------------------------- | ------------------- |
| Audio fingerprint computation on upload         | Backend (AI worker) |
| Fingerprint database + matching engine          | Backend             |
| External platform monitoring (YouTube, Spotify) | Backend             |
| DMCA notice generation from fingerprint matches | Backend             |
| Dispute resolution workflow                     | Frontend + Backend  |

### Deliverables

- Uploaded stems are fingerprinted for identification
- Unlicensed usage on external platforms is detected
- Automated DMCA takedown notices generated
- Dispute resolution process for contested claims

### Estimated Effort

4-6 sprints (requires third-party integrations)

---

## Dependency Graph

```
Phase 1: License Metadata Extension
    │
    ▼
Phase 2: LicenseRegistry + AncestryTracker
    │                    │
    ▼                    ▼
Phase 3: RoyaltySplitter    Phase 4: Exclusive + Legal
                                │
                                ▼
                         Phase 5: Cross-Platform Enforcement
```

---

## Related Issues

| Issue                                                 | Title                                        | Phase      |
| ----------------------------------------------------- | -------------------------------------------- | ---------- |
| [#311](https://github.com/akoita/resonate/issues/311) | Buyer-Facing Licensing UI                    | Phase 1    |
| [#309](https://github.com/akoita/resonate/issues/309) | Recursive Remix Royalties                    | Phase 3    |
| [#280](https://github.com/akoita/resonate/issues/280) | Remix Lineage Visualization                  | Phase 3    |
| [#281](https://github.com/akoita/resonate/issues/281) | Artist Earnings Dashboard                    | Phase 3    |
| [#270](https://github.com/akoita/resonate/issues/270) | Artist Stem Pricing (✅ done)                | Foundation |
| [#285](https://github.com/akoita/resonate/issues/285) | Edition Strategy Configuration               | Phase 2+   |
| [#315](https://github.com/akoita/resonate/issues/315) | Exclusive Licensing & Legal Covenants (IPFS) | Phase 4    |
| [#264](https://github.com/akoita/resonate/issues/264) | Decentralized Encryption                     | Parallel   |
