---
title: "Community Curation & Dispute Resolution — Sprint 1"
status: implemented
owner: "@akoita"
issue: 407
depends_on: [content-protection-architecture, stake_visibility_views]
---

# Community Curation & Dispute Resolution

> **Reference:** [Content Protection Architecture RFC](../rfc/content-protection-architecture.md) §3 & §5 — this feature implements the **community curation loop** for Phase 3 (Governance & Disputes).

## Goal

Enable the community to flag stolen content and resolve disputes through a structured on-chain process: **flag → counter-stake → evidence → resolve → reward/slash**.

## Flow

```
Reporter spots stolen content
        │
        ▼
  reportContent() ─── 20% counter-stake deposited ──► CurationRewards
        │                                                    │
        ▼                                                    ▼
  DisputeResolution.fileDispute()               counterStakes[disputeId] stored
        │
        ▼
  Both parties submit evidence (max 5 each)
        │
        ▼
  Admin marks Under Review → resolves
        │
   ┌────┴────────────────┐──────────────┐
   ▼                     ▼              ▼
 UPHELD              REJECTED       INCONCLUSIVE
   │                     │              │
   ▼                     ▼              ▼
 Reporter gets       Counter-stake    Counter-stake
 counter-stake back  → Creator        refunded
 + bounty            Rep −15          No rep change
 Rep +10
```

## Smart Contracts

### DisputeResolution.sol

Manages the dispute lifecycle with four states:

| State         | Transition                       |
| ------------- | -------------------------------- |
| `Filed`       | Initial state on `fileDispute()` |
| `Evidence`    | First `submitEvidence()` call    |
| `UnderReview` | Admin `markUnderReview()`        |
| `Resolved`    | Admin `resolve(outcome)`         |

Key constraints:

- One active dispute per `tokenId`
- Max 5 evidence submissions per party
- Only reporter or creator may submit evidence
- Only contract owner resolves (Phase 1 — Kleros/DAO jury in future sprints)

### CurationRewards.sol

Orchestrates the economic layer:

| Function                | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `reportContent()`       | Reports stolen content, deposits counter-stake   |
| `claimBounty()`         | Reporter claims refund after `Upheld` outcome    |
| `processRejection()`    | Slashes counter-stake → creator after `Rejected` |
| `processInconclusive()` | Refunds counter-stake after `Inconclusive`       |

Counter-stake defaults to **20% of the creator's stake** (`counterStakeBps = 2000`, admin-configurable).

On-chain reputation tracks `successfulReports` and `rejectedReports` per curator.

## Backend API

Base path: `/api/metadata/`

| Method | Route                     | Purpose                                            |
| ------ | ------------------------- | -------------------------------------------------- |
| GET    | `disputes/token/:tokenId` | Disputes by token                                  |
| GET    | `disputes/reporter/:addr` | Disputes filed by reporter                         |
| GET    | `disputes/creator/:addr`  | Disputes against creator                           |
| POST   | `disputes`                | File new dispute                                   |
| POST   | `disputes/:id/evidence`   | Submit evidence                                    |
| PATCH  | `disputes/:id/resolve`    | Admin resolve (`upheld`/`rejected`/`inconclusive`) |
| GET    | `curators/:address`       | Get curator reputation                             |
| GET    | `curators/leaderboard`    | Top curators by score                              |

### Data Models (Prisma)

```
Dispute ──< DisputeEvidence
CuratorReputation (per wallet)
```

- `Dispute`: tokenId, reporterAddr, creatorAddr, status, outcome, evidenceURI, counterStake
- `DisputeEvidence`: submitter, party (reporter/creator), evidenceURI, description
- `CuratorReputation`: score, successfulFlags, rejectedFlags, totalBounties

## Frontend

### Report Flow

Non-owners see a **🚩 Report stolen content** button on release pages. Clicking opens `ReportContentModal` which collects:

- Evidence URL (required) — link to original content
- Description (optional)

### Dispute Dashboard (`/disputes`)

Two tabs:

- **My Reports** — disputes filed by the connected wallet
- **Against My Content** — disputes targeting the wallet's content

Includes a **reputation badge** showing score, successful flags, and rejected flags.

## Testing

| Layer     | Tests                                                        | Result      |
| --------- | ------------------------------------------------------------ | ----------- |
| Contracts | 40 Foundry tests (25 DisputeResolution + 15 CurationRewards) | ✅ Pass     |
| Backend   | `tsc --noEmit`                                               | ✅ Clean    |
| Frontend  | `npm run lint`                                               | ✅ 0 errors |

## Sprint 2 (Complete)

- ✅ Appeal process (max 2 appeals, 2× stake, losing-party-only)
- ✅ Indexer integration for `DisputeFiled`/`DisputeResolved`/`DisputeAppealed`/`BountyClaimed`
- ✅ Admin dispute queue (`GET /disputes/pending`, `PATCH /:id/review`)
- ✅ Curator leaderboard (`/disputes/leaderboard`)
- ✅ Frontend: AdminDisputeQueue, CuratorLeaderboard, appeal button in DisputeDashboard

## Sprint 3 (Complete)

- ✅ `NotificationService` — event bus → persist → WebSocket emit
- ✅ `Notification` + `NotificationPreference` Prisma models
- ✅ 5 REST endpoints (list, read, read-all, get/update preferences)
- ✅ WebSocket gateway: 4 dispute event subscriptions + wallet room targeting
- ✅ `useDisputeNotifications` hook, `NotificationBell`, `NotificationPreferences`
- ✅ Real-time auto-refresh in `DisputeDashboard`

## Future Sprints

- **Sprint 4:** Kleros/DAO jury for decentralized arbitration
- **Sprint 5:** Proof-of-humanity gate, enhanced reputation system
- **Sprint 6:** E2E testing, security audit, deployment
- **Sprint 7:** Public analytics, anti-abuse hardening
