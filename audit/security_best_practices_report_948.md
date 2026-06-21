# Security Best Practices Report: Issue #948

## Executive Summary

Issue #948 adds a `ShowCampaignEscrow` on-chain event indexer that reconciles
backend campaign/pledge funding state from chain events, and flips pledge
confirmation from client-submitted transaction hashes to on-chain truth. A
scoped review plus two adversarial passes (correctness + security) found **no
Critical or High findings remaining** — the payments-critical correctness/
security issues surfaced in review were fixed in this branch (commit
`7d9df91`). One **Low** finding is pre-existing (unverified pledge wallet) and
is tracked as a separate security follow-up.

## Critical Findings

None.

## High Findings

None. (Two High correctness issues found in adversarial review were fixed before
this report — see Resolved In Review.)

## Medium Findings

None. (Resolved in review — see below.)

## Low Findings

### SBPR-948-L1: Unverified `walletAddress` on pledge intents (pre-existing)

**File:** `backend/src/modules/shows/shows.service.ts` (`createPledgeIntent`)
**Impact:** `createPledgeIntent` accepts a client-supplied `walletAddress` with
no ownership proof (no SIWE/signature check). Because the #948 indexer confirms
a pledge when it matches an on-chain `Pledged(campaignId, backer, amount)` to a
backend intent by `(campaign, backer wallet, exact amount)`, an attacker who
pre-creates an intent with a victim's public wallet + the same amount can have
the victim's on-chain pledge attributed to the attacker's account — unlocking
community supporter badges/rooms keyed on `pledge.userId`.
**Status:** Pre-existing (predates #948). The exact-amount match added in this
PR narrows the window but does not close it. Tracked as a dedicated security
follow-up: require wallet-ownership proof at pledge-intent creation (or verify
ownership before the indexer flips a pledge to `confirmed`).
**Recommendation:** Bind `walletAddress` to the authenticated user via SIWE /
signature at intent creation, or join `prisma.wallet` and require
`wallet.userId === actor.userId` before confirmation.

## Resolved In Review (correctness/security, fixed in `7d9df91`)

- **Atomic reconciliation (was High):** event row + reconciliation writes +
  `processedAt` now commit in one `prisma.$transaction`; the skip guard checks
  `processedAt`, so a reconcile failure rolls back and retries instead of
  permanently dropping payment-state reconciliation, and accounting cannot be
  half-applied or double-counted.
- **Fail-closed campaign binding (was security Medium):** `reconcile` binds
  strictly to `(chainId, escrow address, campaignId)` and emits a mismatch
  (no mutation) when 0 or >1 campaigns match, so events cannot mutate the wrong
  campaign.
- **Exact pledge matching (was Medium):** pledges confirm only on exact
  `(backer, amount)`; no arbitrary-intent confirmation.
- **Terminal-state guard (was Medium):** a late/reordered `Pledged` on a
  cancelled/refunded campaign is ignored.

## Scope Reviewed

- `backend/src/modules/shows/shows-escrow-indexer.service.ts` (new indexer +
  reconciliation)
- `backend/src/modules/shows/shows.service.ts` (`confirmPledge` trust flip,
  `configuredShowCampaignEscrowAddress`)
- `backend/src/modules/shows/shows.module.ts` (DI wiring)
- `backend/src/events/event_types.ts` (`shows.campaign_reconciliation_mismatch`)
- `backend/prisma/schema.prisma` + migration `20260621120000_show_campaign_escrow_indexer`

## Checks

- **Hardcoded secret scan** over changed files — none (only `process.env` reads).
- **Raw SQL scan** — none; all DB access is Prisma ORM, with the multi-write
  reconciliation wrapped in `prisma.$transaction`. No `queryRawUnsafe`/
  `executeRawUnsafe` / string-interpolated SQL.
- **Unsafe deserialization scan** — no `JSON.parse`/`eval` in changed code; chain
  logs are decoded with viem `decodeEventLog` against a fixed ABI allow-list and
  stringified via `sanitizeArgs` before persistence.
- **Trust-boundary review** — wallet users can no longer self-confirm pledges
  (only the indexer or an operator override can); the indexer ingests logs only
  from the configured escrow address and binds events to the address-matched
  campaign, so spoofed-contract events cannot mutate state.
- **Authorization review** — `configuredShowCampaignEscrowAddress` fails closed
  on unset/zero/malformed addresses; reconciliation fails closed on ambiguous
  campaign binding.
- **Data-exposure review** — the reconciliation-mismatch event and logs carry
  only public on-chain data (campaign id, event name, tx hash, block, wallet,
  coarse reason); no secrets, keys, or non-public PII.

No Critical/High/Medium issues remain in this branch. The single Low finding is
a pre-existing trust gap tracked as a separate follow-up.
