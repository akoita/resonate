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
| Signature Verification | [EIP-1271](https://eips.ethereum.org/EIPS/eip-1271) | Smart contract signature validation |
| Audio Processing | [Demucs](https://github.com/facebookresearch/demucs) | State-of-the-art source separation |

---

## 4. Architecture

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
│  │ StemRegistry │  │ RemixFactory │  │   PaymentSplitter    │   │
│  │  (ERC-1155)  │  │ (Composable) │  │   (USDC Distribution)│   │
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

## 5. Key Features (MVP)

1. **Smart Stem Upload** — Drag-and-drop audio → AI separation → IPFS storage → IP-NFT mint
2. **Agent Wallet** — ERC-4337 smart account with monthly budget cap for autonomous spending
3. **Remix Engine** — On-chain registry composing stems into derivative works
4. **Transparent Analytics** — Real-time dashboard showing payment flows

---

## 6. Technology Stack

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

## 7. Roadmap

### Phase 0: Foundations ✅
- Repository structure, CI/CD skeleton
- Core domain entities and event taxonomy
- Environment and tooling setup

### Phase 1: MVP Prototype
- Artist upload flow with stem separation
- Catalog indexing and metadata schema
- Wallet funding with budget enforcement
- Basic playback with micro-payments

### Phase 2: Alpha
- Agentic session orchestration
- Remix engine contract integration
- Analytics dashboard v1
- Observability and SLOs

### Phase 3: Beta
- Recommendation model improvements
- Curator staking workflow
- Security review and data retention
- Performance optimization

### Phase 4: Launch
- L2 scale testing
- Partner onboarding
- Public documentation
- Feature freeze and launch

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Time-to-first-track | < 10 minutes |
| 30-day listener retention | > 20% |
| Successful on-chain payments | > 95% |

---

## 9. References

- [EIP-4337: Account Abstraction](https://eips.ethereum.org/EIPS/eip-4337)
- [EIP-1155: Multi Token Standard](https://eips.ethereum.org/EIPS/eip-1155)
- [EIP-1271: Standard Signature Validation](https://eips.ethereum.org/EIPS/eip-1271)
- [Demucs: Music Source Separation](https://github.com/facebookresearch/demucs)
- [ZeroDev: Smart Wallet SDK](https://zerodev.app/)
