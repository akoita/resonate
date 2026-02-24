---
title: "Phase 0: Architecture & Service Boundaries"
status: draft
owner: "@akoita"
---

# Phase 0: Architecture & Service Boundaries

## Objectives

- Define service boundaries and responsibilities.
- Document core APIs and authentication model.
- Identify integration points with blockchain, storage, and AI.

## Service Responsibilities

| Service              | Responsibility                         | Dependencies                                                       |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Identity & Wallet    | Auth, account abstraction, budget caps | ZeroDev (passkeys), ERC-4337                                       |
| Ingestion & AI       | Upload, stem separation, storage       | Storage (Local/IPFS/GCS), Demucs Worker, GCP Pub/Sub, Redis/BullMQ |
| Catalog & Rights     | Metadata, licensing, indexing          | Indexer, chain events                                              |
| Session Orchestrator | AI DJ session and negotiation          | Catalog, Wallet, Payments                                          |
| Payments             | On-chain settlement and splits         | Payment splitter contract                                          |
| Analytics            | Reporting, dashboards, metrics         | BigQuery, dbt                                                      |

## API Surface (BFF)

- `POST /auth/login`
- `POST /wallet/fund`
- `POST /stems/upload`
- `GET /catalog`
- `POST /sessions/start`
- `POST /licenses/grant`
- `GET /analytics/artist/:id`

## Auth Model (Initial)

- User auth via ZeroDev passkeys (Kernel v3 smart account).
- API Gateway issues short-lived JWTs.
- Wallet actions require signed intent or AA sponsorship policy.

## Integration Points

### Blockchain

- Event indexing for IP-NFT minting and payments.
- On-chain registry for stems and remix relationships.
- Payment splitter for payouts.

### Storage

- GCS for raw uploads and processed outputs.
- IPFS for content-addressable distribution.

### AI / Audio Processing

- **Demucs Worker** for stem separation (containerized FastAPI + Pub/Sub consumer).
  - Model: `htdemucs_6s` (6-stem: vocals, drums, bass, guitar, piano, other)
  - GPU support available via `docker-compose.gpu.yml`
  - Model pre-cached in Docker image (~1GB)
- **GCP Pub/Sub** for event-driven job dispatch (Phase 2).
  - Topics: `stem-separate` (jobs), `stem-results` (completions), `stem-dlq` (dead letters)
  - Workers pull from subscription with consumer group semantics
  - Dead letter queue after 3 delivery attempts
- **BullMQ** for initial upload queue processing with Redis backend.
- Model version tracking in `stems.processed` events (`modelVersion: "demucs-htdemucs-6s"`).

## Non-Goals (Phase 0)

- Multi-region deployments.
- Custom L2 deployment tooling.
