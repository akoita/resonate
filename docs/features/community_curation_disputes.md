---
title: "Community Curation & Dispute Resolution"
status: partial
owner: "@akoita"
issue: 407
depends_on: [content-protection-architecture, stake_visibility_views]
---

# Community Curation & Dispute Resolution

> **Reference:** [Content Protection Architecture RFC](../rfc/content-protection-architecture.md) §3 & §5 — this feature implements the **community curation loop** for Phase 3 (Governance & Disputes).

## Goal

Enable the community to flag stolen content and resolve disputes through a structured on-chain process: **flag → counter-stake → evidence → resolve → reward/slash**.

## Current Status

This feature area is only partially shipped.

- Sprint 3 notification work is shipped.
- Sprint 4 jury arbitration remains tracked in open issue [#432](https://github.com/akoita/resonate/issues/432).
- Sprint 5 proof-of-humanity gate and advanced reputation remain tracked in open issue [#433](https://github.com/akoita/resonate/issues/433).
- The repo contains backend and UI groundwork in several places, but the GitHub tracker is the source of truth for what is fully delivered versus still in progress.

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

Manages the dispute lifecycle with six states:

| State         | Transition                                            |
| ------------- | ----------------------------------------------------- |
| `Filed`       | Initial state on `fileDispute()`                      |
| `Evidence`    | First `submitEvidence()` call                         |
| `UnderReview` | Admin `markUnderReview()`                             |
| `Escalated`   | Admin `escalateToJury()` — jurors assigned            |
| `JuryVoting`  | First `castJuryVote()` — voting in progress           |
| `Resolved`    | Admin `resolve()` or `finalizeJuryDecision()`         |

Key constraints:

- One active dispute per `tokenId`
- Max 5 evidence submissions per party
- Only reporter or creator may submit evidence
- Admin resolves directly, or escalates to DAO jury for decentralized arbitration
- Jury uses pseudo-random selection from staked juror pool (`prevrandao`)
- Supermajority voting (⌊n/2⌋ + 1) with 7-day deadline

### CurationRewards.sol

Orchestrates the economic layer:

| Function                | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `reportContent()`       | Reports stolen content, deposits counter-stake   |
| `claimBounty()`         | Reporter claims refund after `Upheld` outcome    |
| `processRejection()`    | Slashes counter-stake → creator after `Rejected` |
| `processInconclusive()` | Refunds counter-stake after `Inconclusive`       |

Counter-stake starts at **20% of the creator's stake** (`counterStakeBps = 2000`, admin-configurable), then shifts by curator reputation tier:

- negative score: **30%**
- neutral / new: **20%**
- trusted (`score >= 20`): **15%**
- elite (`score >= 50`): **10%**

On-chain reputation tracks `successfulReports` and `rejectedReports` per curator, while the backend adds decay, badges, and proof-of-humanity state for higher-volume reporters.

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
| GET    | `disputes/juror/:addr`    | Disputes assigned to juror                         |
| PATCH  | `disputes/:id/escalate-jury` | Escalate dispute to DAO jury arbitration        |
| PATCH  | `disputes/:id/jury-vote`  | Cast jury vote (`reporter`/`creator`)              |
| PATCH  | `disputes/:id/finalize-jury` | Finalize jury decision                          |
| GET    | `curators/:address`       | Get curator reputation                             |
| GET    | `curators/:address/reporting-policy` | Get reporting gate + stake tier policy |
| GET    | `curators/:address/verification` | Get proof-of-humanity status |
| POST   | `curators/:address/verification` | Verify via Passport / World ID / mock |
| GET    | `curators/leaderboard`    | Top curators by score                              |

### Data Models (Prisma)

```
Dispute ──< DisputeEvidence
       ──< DisputeJurorAssignment
CuratorReputation (per wallet)
```

- `Dispute`: tokenId, reporterAddr, creatorAddr, status, outcome, evidenceURI, counterStake, escalatedToJuryAt, juryDeadlineAt, jurySize, juryVotesForReporter, juryVotesForCreator, juryFinalizedAt
- `DisputeEvidence`: submitter, party (reporter/creator), evidenceURI, description
- `DisputeJurorAssignment`: disputeId, jurorAddr, vote, assignedAt, votedAt (unique on disputeId+jurorAddr)
- `CuratorReputation`: score, successfulFlags, rejectedFlags, totalBounties, reportsFiled, lastActiveAt, proof-of-humanity state

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

Delivered across PRs #436 (notification infrastructure), #461 (mounted notification UI), and #462 (end-to-end hardening and reconnect/test coverage).

- ✅ `NotificationService` — event bus → persist → WebSocket emit
- ✅ `Notification` + `NotificationPreference` Prisma models
- ✅ 5 REST endpoints (list, read, read-all, get/update preferences)
- ✅ WebSocket gateway: 4 dispute event subscriptions + wallet room targeting
- ✅ `useDisputeNotifications` hook, `NotificationBell`, `NotificationPreferences`
- ✅ Real-time auto-refresh in `DisputeDashboard`

## Sprint 4 (Planned / In Progress)

Tracked by open issue [#432](https://github.com/akoita/resonate/issues/432).

Target scope:

- DAO jury or Kleros-style arbitration path after admin review
- Jury assignment, voting, and finalization
- Juror-facing dashboard and arbitration timeline
- Integration with the existing dispute lifecycle

## Sprint 5 (Planned / In Progress)

Tracked by open issue [#433](https://github.com/akoita/resonate/issues/433).

Target scope:

- Proof-of-humanity gate for higher-volume reporters
- Advanced reputation decay, tiers, and badges
- Curator profile and verification UX
- Reputation-aware counter-stake policy

## Future Sprints

- **Sprint 6:** E2E testing, security audit, deployment
- **Sprint 7:** Public analytics, anti-abuse hardening
