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
- Sprint 4 jury arbitration capability shipped through [#432](https://github.com/akoita/resonate/issues/432), including lifecycle states, backend endpoints, assignment/voting/finalization paths, and user-facing jury panels.
- Sprint 5 proof-of-humanity and advanced reputation capability shipped through [#433](https://github.com/akoita/resonate/issues/433), including reporting policy, proof-of-humanity status, curator profiles, and reputation-aware counter-stake tiers.
- The remaining gap is production readiness: richer evidence UX, clearer juror onboarding, admin escalation/finalization ergonomics, appeal/post-resolution workflows, E2E/security/deployment validation, and analytics/anti-abuse hardening.
- GitHub issue [#407](https://github.com/akoita/resonate/issues/407) remains the parent roadmap item for this area; open follow-ups are listed below so backend capability and product readiness are not conflated.

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

Primary tabs:

- **My Reports** — disputes filed by the connected wallet
- **Against My Content** — disputes targeting the wallet's content
- **Jury Duty** — disputes assigned to the connected wallet for jury voting

Includes a reputation badge showing score, successful flags, rejected flags, reporting policy, proof-of-humanity state, and jury panels when assignments exist.

## Testing

The table below captures the historical verification for the shipped slices. Production readiness still needs the broader E2E/security work tracked in [#434](https://github.com/akoita/resonate/issues/434).

| Layer     | Coverage                                                        | Status      |
| --------- | --------------------------------------------------------------- | ----------- |
| Contracts | Dispute and curation unit coverage, including jury primitives    | Shipped     |
| Backend   | Dispute, jury, notification, reputation, and verification paths  | Shipped     |
| Frontend  | Dashboard, notification, jury panel, curator profile surfaces    | Shipped     |
| E2E / Ops | Full lifecycle E2E, security scan, deployment/load validation    | Open in #434 |

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

## Sprint 4 (Capability Shipped)

Tracked by closed issue [#432](https://github.com/akoita/resonate/issues/432).

Delivered capability:

- DAO-style jury escalation after admin review
- Jury assignment, voting, and finalization endpoints
- Dispute lifecycle states for `Escalated` and `JuryVoting`
- Juror-facing dashboard panels inside `/disputes`
- Jury assignment notifications and timeline markers

Remaining product hardening:

- [#466](https://github.com/akoita/resonate/issues/466) — juror onboarding, assignment visibility, and account guidance
- [#468](https://github.com/akoita/resonate/issues/468) — admin jury escalation and finalization workflow

## Sprint 5 (Capability Shipped)

Tracked by closed issue [#433](https://github.com/akoita/resonate/issues/433).

Delivered capability:

- Proof-of-humanity gate for higher-volume reporters
- Advanced reputation decay, tiers, and badges
- Curator profile and verification UX
- Reputation-aware counter-stake policy

Remaining product hardening:

- [#469](https://github.com/akoita/resonate/issues/469) — in-app evidence submission workflow for reporter and creator
- [#465](https://github.com/akoita/resonate/issues/465) — in-app appeal workflow and post-resolution actions

## Future Sprints

- **Sprint 6:** E2E testing, security audit, deployment — tracked in [#434](https://github.com/akoita/resonate/issues/434)
- **Sprint 7:** Public analytics, anti-abuse hardening — tracked in [#435](https://github.com/akoita/resonate/issues/435)

## Open Product-Readiness Follow-Ups

- [#465](https://github.com/akoita/resonate/issues/465) — Dispute Center: implement in-app appeal workflow and post-resolution actions
- [#466](https://github.com/akoita/resonate/issues/466) — Juror UX: onboarding, assignment visibility, and account guidance
- [#468](https://github.com/akoita/resonate/issues/468) — Dispute Center: add admin jury escalation and finalization workflow
- [#469](https://github.com/akoita/resonate/issues/469) — Dispute Center: add in-app evidence submission workflow for reporter and creator
- [#434](https://github.com/akoita/resonate/issues/434) — E2E testing, security audit, deployment
- [#435](https://github.com/akoita/resonate/issues/435) — Public analytics and anti-abuse hardening
