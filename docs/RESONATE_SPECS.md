# Project Resonate: The Agentic Audio Protocol

> A decentralized, AI-native music streaming protocol where artists monetize audio stems as programmable IP and users deploy AI agents to curate, remix, and negotiate usage rights in real-time.

---

## 1. Vision & Market Context

### The Problem

Traditional streaming platforms offer artists ~$0.003 per stream with opaque royalty calculations. Meanwhile, the **Web3 music market** is projected to reach [$1.7B by 2025](https://www.binance.com/en/blog/nft/what-are-music-royalty-nfts-and-what-does-this-mean-for-artists-5546891929011655284), with platforms like **Audius**, **Royal**, and **Opulous** pioneering new models.

### Resonate's Differentiation

| Platform | Model | Resonate Advantage |
|----------|-------|-------------------|
| **Audius** | Decentralized streaming | No stem-level monetization |
| **Royal** | Royalty NFT investment | No AI agent integration |
| **Opulous** | DeFi royalty advances | Not a streaming platform |
| **Resonate** | Stem IP + AI Agents + Micro-payments | Full-stack agentic experience |

---

## 2. Core Value Propositions

### For Artists (The "IP Liquidity" Layer)
Instead of per-stream earnings, artists upload **Stem Kits** (drums, vocals, bass) as programmable IP with dynamic pricing for remixing and commercial use.

### For Listeners (The "Agentic" Experience)
Users deploy **Personal AI DJ Agents** that scan the blockchain for tracks matching mood/budget, negotiate micro-payments, and generate seamless transitions.

### For Curators ("Proof of Taste")
Stake stablecoins on emerging artists. If an AI Agent discovers a hit early, earn yield from future royalties.

---

## 3. Technical Standards

Resonate builds on established Ethereum standards:

| Component | Standard | Implementation |
|-----------|----------|----------------|
| Smart Wallets | [EIP-4337](https://eips.ethereum.org/EIPS/eip-4337) | Account Abstraction with bundler/paymaster |
| Stem NFTs | [EIP-1155](https://eips.ethereum.org/EIPS/eip-1155) | Multi-token for stem collections |
| Royalty Info | [EIP-2981](https://eips.ethereum.org/EIPS/eip-2981) | On-chain royalty signaling |
| Revenue Splits | [0xSplits](https://splits.org/) | Trustless, composable revenue distribution |
| Signature Verification | [EIP-1271](https://eips.ethereum.org/EIPS/eip-1271) | Smart contract signature validation |
| Audio Processing | [Demucs](https://github.com/facebookresearch/demucs) (htdemucs_6s) | 6-stem separation: vocals, drums, bass, guitar, piano, other |
| Agent Identity | [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) | Trustless Agent Identity & Reputation |

---

---

## 4. Agent Trust & Identity (ERC-8004)

To enable a truly open "Agentic Economy," Resonate adopts **ERC-8004 (Trustless Agents)**. This standard, now live on Ethereum Mainnet, complements the execution layer (ERC-4337) by providing a portable identity and reputation layer for AI agents.

### Why ERC-8004?
- **Portable Identity**: Agents have an on-chain resume (Identity NFT) that persists across platforms.
- **Proof of Taste**: A standardized "Reputation Registry" allows agents to build a verifiable track record of curation success.
- **Discovery**: Users can discover agents based on verified capabilities and historical performance (e.g., "Show me agents with >90% ROI on Techno tracks").

### Integration Strategy

#### Phase 1: Identity (The "Agent ID")
Every Resonate Agent (Smart Account) is minted a corresponding **ERC-8004 Identity**.
- **Registration File**: Stores the agent's "System Prompt", "Vibe Settings" (e.g., Deep House specialist), and operational parameters.
- **On-Chain Link**: The Identity NFT is bound to the Agent's ERC-4337 wallet address.

#### Phase 2: Reputation (The "Taste Score")
Resonate publishes curation outcomes to the **ERC-8004 Reputation Registry**.
- **Signals**: When an agent "bets" on a track that later gains traction, the protocol emits a positive reputation signal.
- **Leaderboards**: Verified "Taste Scores" drive the discovery of high-performing agents.

---

## 5. Architecture

### Architectural Style
Event-Driven Microservices with Hexagonal Architecture (Ports & Adapters).

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Frontend                            │
│                      (Next.js 15 + Wagmi)                       │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                     Backend Services                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   Identity   │  │   Catalog    │  │     Ingestion        │   │
│  │   & Wallet   │  │   & Rights   │  │   & AI Processing    │   │
│  │  (Passport)  │  │   (Ledger)   │  │   (Stem Separation)  │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────────┐
│                    Blockchain Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ StemRegistry │  │ RemixFactory │  │ RoyaltyDistribution  │   │
│  │  (ERC-1155)  │  │ (Composable) │  │   (0xSplits-based)   │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│                      Base / Arbitrum L2                         │
└─────────────────────────────────────────────────────────────────┘
```

### Data Stores

| Store | Purpose |
|-------|---------|
| PostgreSQL | Users, wallets, metadata, catalog |
| IPFS/GCS | Audio stems, remix outputs |
| BigQuery | Analytics, payout reports |

---

## 6. Key Features (MVP)

1. **Smart Stem Upload** — Drag-and-drop audio → AI separation → IPFS storage → IP-NFT mint
2. **Agent Wallet** — ERC-4337 smart account with monthly budget cap for autonomous spending
3. **Remix Engine** — On-chain registry composing stems into derivative works
4. **Transparent Analytics** — Real-time dashboard showing payment flows

---

## 7. Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Backend** | TypeScript + NestJS | Type safety, DI, hexagonal architecture |
| **Frontend** | Next.js 15 (App Router) | React Server Components, SEO |
| **State** | TanStack Query | Async state management |
| **Blockchain** | Viem + Wagmi | Modern, type-safe Ethereum client |
| **Contracts** | Solidity + Foundry | Professional-grade tooling |
| **Database** | PostgreSQL (Prisma) | Relational data, migrations |
| **Analytics** | BigQuery + dbt | Data warehouse, transformations |
| **AI** | Vertex AI | Agent orchestration |
| **Infra** | Docker + Cloud Run | Serverless containers |

---

## 8. Project Status

### Current Focus
- Core infrastructure: authentication, catalog, playback
- Smart wallet integration (ERC-4337)
- Stem upload and management

### Exploration Areas
The following represent potential directions, not commitments:

| Area | Description |
|------|-------------|
| **AI Agents** | Autonomous curation, remix generation, negotiation |
| **Remix Engine** | On-chain composition of stems into derivative works |
| **Curator Economy** | Staking mechanisms for early discovery rewards |
| **Analytics** | Real-time payout visibility and artist dashboards |
| **L2 Scaling** | Deployment on Base/Arbitrum for lower fees |

---


## 9. Success Metrics

| Metric | Target |
|--------|--------|
| Time-to-first-track | < 10 minutes |
| 30-day listener retention | > 20% |
| Successful on-chain payments | > 95% |

---

## 10. References

- [EIP-4337: Account Abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [EIP-1155: Multi Token Standard](https://eips.ethereum.org/EIPS/eip-1155)
- [EIP-1271: Standard Signature Validation](https://eips.ethereum.org/EIPS/eip-1271)
- [EIP-2981: NFT Royalty Standard](https://eips.ethereum.org/EIPS/eip-2981)
- [0xSplits: Revenue Distribution Protocol](https://splits.org/)
- [Demucs: Music Source Separation](https://github.com/facebookresearch/demucs) (htdemucs_6s model)
- [ZeroDev: Smart Wallet SDK](https://zerodev.app/)

