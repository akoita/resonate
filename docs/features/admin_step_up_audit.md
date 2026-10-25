# Admin step-up confirmation and the admin audit log

Status: `in-progress` — tracked in
[#2173](https://github.com/akoita/resonate/issues/2173) (Sprint 41) and
[#2362](https://github.com/akoita/resonate/issues/2362) (Sprint 42) and
[#2380](https://github.com/akoita/resonate/issues/2380) (Sprint 43). Step-up and
audit now cover every admin and operator route; what is deliberately left is
under "Not covered".

Revenue line: vision-neutral operations/security infrastructure (`vision:keep`).
There are no fee, split, price or payout changes (ADR-BM-4 untouched).

## What it is

1. **Step-up.** A valid admin session is not enough to suspend or close an
   account or to broadcast to everyone. These routes also need a *fresh*
   confirmation from the signed-in person's own passkey (or wallet), checked by
   the server, valid for at most 5 minutes.
2. **One audit log.** Every operator access and action is written to a single
   append-only table, `AdminAuditEvent`, and admins can read it on `/admin/audit`.

## Step-up

- `POST /admin/step-up/challenge` (roles `admin`, `operator`) returns
  `{ address, message, challengeToken, expiresAt }`. The address comes from the
  account, never the caller; the message is built by the server from the address
  and a nonce.
- `POST /admin/step-up/verify` takes `{ address, signature, challengeToken }`
  (class DTO, `400` on malformed input) and returns
  `{ proof, expiresAt, ttlSeconds }`.
- `@RequireStepUp()` marks a route. The global `AdminStepUpGuard`
  (`APP_GUARD`, after `RolesGuard`) answers
  `403 { code: "step_up_required" | "step_up_expired" | "step_up_invalid" }`
  unless the request carries a valid proof in the `X-Admin-Step-Up` header.
  Routes are listed in "Admin routes" below. Lifting a suspension only restores
  access and does not need it; targeted notices are audited but not gated. Pinned
  by `admin_step_up_routes.spec.ts`.
- `ADMIN_STEP_UP_TTL_SECONDS` (default `300`, clamped to 30-300).

### Decisions

- **A fresh signature, not a raw WebAuthn assertion.** `WebAuthnCredential` is
  keyed by a per-registration id that is not `User.id`, so a verified assertion
  cannot be tied to the signed-in account. A passkey account signs through its
  smart account (the same passkey prompt as sign-in), verified through
  ERC-6492/ERC-1271; an EOA admin signs with the wallet. The check is the one the
  account-closure step-up uses (`wallet_signature_check.ts`, shared).
  `AdminStepUpService` documents this.
- **Signed token, not a server-side record.** The proof needs no revocation
  inside five minutes, works on every instance without a shared store and adds no
  personal-data table. The revocable, queryable record is the audit log.
- **Not a JWT.** The session `JwtStrategy` accepts any token signed with the
  session secret, so a step-up JWT could be replayed as a session. The proof uses
  its own format signed with a key derived from the session secret under a
  different label, is bound to the admin's user id, has its own purpose, and
  never extends the session.
- **Stateless challenge.** Signed, 2 minutes, spent on first answer on the
  instance that answers it; a failed signature burns it. Across instances a
  replay needs the admin's session token as well and can only mint a proof for
  that same admin.
- **A refusal is 400 (bad signature, challenge) or 403 (address not this
  account's), never 401**, because the web client treats every 401 as a dead
  session.
- **A proof is never issued unless its audit record was written.**

## Audit log

- Model: `AdminAuditEvent` (#2166) gains `outcome` (`success` | `denied`) and
  indexes on `(action, createdAt)` and `(createdAt)`. Migration
  `20261025100000_admin_audit_outcome`. The only writer is
  `writeAdminAuditEvent` (module `admin_audit`); the table is only ever inserted
  into by application code (erasure rewrites the two id columns).
- Actions (`ADMIN_AUDIT_ACTIONS`): `user.detail_viewed`, `account.suspended`,
  `account.unsuspended`, `account.closed` (#2147, #2166),
  `agent_session.events_viewed` (#2259), `notice.broadcast_sent`,
  `notice.targeted_sent` (operator-sent only; `system:` senders are not admin
  actions), `admin.step_up_verified`, `admin.step_up_refused` (`denied`), and,
  since #2362, one action per admin route in the table below.
- **Two writers.** Account, notice, user-detail, agent-session and step-up actions
  are written by their services (they need a transaction or the outcome). Every
  other route uses `@AdminAudit(action, describe)` from
  `admin_audit.interceptor.ts`: after the handler succeeds it writes one row with
  the verified caller as actor, the describer's `targetUserId` and `detail`. A
  request refused by the role or step-up guard, or whose handler throws, writes
  nothing. The write is awaited before the response and a failed write is logged,
  not surfaced (the action has already happened). A describer reads named keys
  through `auditRef` (identifier-shaped strings), `auditCode` (a closed set),
  `auditNumber`, `auditBoolean` and `auditCount`; any other value is dropped, so a
  note or message typed by an operator cannot reach the log.
- **What is recorded.** Every mutation by an admin or operator, plus the reads that
  open a person's content (review queues with evidence, claimant contacts, refund
  payers). Aggregate operational status reads are not. `admin_audit_coverage.spec.ts`
  fails when an `admin` or `operator` route has neither `@AdminAudit` nor a listed
  reason.
- `detail` is a reason category, identifiers, counts or a refusal reason. Never
  an operator note, a notice's text or a signature.
- Read: `GET /admin/audit-events` (admin only, `403` for operators), newest first,
  filters `action`, `outcome`, `actor`, `target`, `from`, `to`, `page`,
  `pageSize` (max 100). Web: `/admin/audit` ("Audit Log" in the sidebar).
  Reading the log is not itself logged.
- **Retention and privacy.** Kept as audit history with no deletion job, as the
  privacy policy states; erasure rewrites `actorUserId` and `targetUserId`.
  Export: rows about the person (`targetUserId`) with the operator redacted. See
  `docs/engineering/personal-data-inventory.md`. A numeric retention period is a
  deployment decision.

## Web

`web/src/lib/adminStepUp.ts` `withAdminStepUp`: tries the call with any proof
still fresh; on `403 step_up_*` asks for a challenge, has the person sign the
server's words with the existing passkey prompt (`useAuth().signMessage`), verifies,
and retries once. The proof is remembered in memory per session for the window, so
the prompt appears once per window. A dismissed prompt is a quiet "nothing changed".
Wired into `AccountRestrictionControls` (suspend, close), the notices page
(broadcast), the Credit Requests page (grant), the management recovery page
(approve and reject), the community moderation page (resolve) and, since #2380,
the Shows operator panel (`CampaignOperatorPanel`: confirm booking, confirm
fulfilment, resolve dispute; the Shows client throws `ApiRequestError` so a
`403 step_up_*` is recognised). A dismissed passkey prompt shows an info toast
("Nothing changed") and sends nothing. `POST /admin/x402-refunds/:id/mark-refunded`
has no screen yet; it is reached with the API and needs the `X-Admin-Step-Up`
header (see the x402 refund runbook). The other gated routes have no screen yet
either. `/help` article
`admin-users` covers it, and the credit and recovery articles mention it.

## Admin branches inside user-facing routes (#2380)

Some routes people use for their own data let an admin or operator in through a
role check. When that branch is taken for someone else's data, one
`AdminAuditEvent` is written by `auditAdminBranch` (`admin_branch_audit.ts`):
ids, codes and counts only, the data's owner as `targetUserId`. The owner's own
access, an admin acting on their own data, a refused caller and a call with no
audit actor write nothing (the helper also skips a target equal to the actor). Like
every non-`required` write, a failed audit write is logged and does not block the
read. None of these is step-up gated: they are reads, or narrow support writes.

| Branch | Audit action | Detail |
| --- | --- | --- |
| `GET /wallet/:id` (admin reads any wallet) | `wallet.support_viewed` | target = wallet owner |
| `POST /wallet/fund`, `/budget` (admin names another user; recorded after success) | `wallet.support_changed` | `change` |
| `GET /metadata/collection/:address` (admin/operator support read) | `collection.support_viewed` | `address` |
| `GET /metadata/notifications/:address`, `/preferences` (support read; writes stay owner-only) | `notifications.support_viewed` | `address` |
| `GET /metadata/listings/owner/:seller` (admin) | `seller_listings.support_viewed` | `seller` |
| `POST /metadata/notify-listing` (admin/operator names another seller or links another's stem) | `listing_intent.support_recorded` | `sellerAddress`, `stemId` |
| `POST /metadata/evidence/bundles` with a privileged evidence role (admin only) | `rights_evidence.privileged_submitted` | `evidenceRole`, `subjectType`, `subjectId` |
| `GET /metadata/release-rights/releases/:id` (admin, not the owner) | `release_rights_request.support_viewed` | `releaseId`, target = artist owner |
| `GET /metadata/rights-reassessments/releases/:id` (admin, not the owner) | `rights_reassessment_history.support_viewed` | `releaseId`, target = artist owner |
| `GET /analytics/artist/:id`, `/v1` (admin, not the owner) | `artist_analytics.support_viewed` | `artistId`, target = artist owner |
| Shows campaign edit, visuals, request authority, activate, cancel by an operator who is not the artist | `show_campaign.operator_accessed` | `campaignId`, `via` (closed code) |
| Shows pledge confirm and refund confirm by an operator for another person's pledge | `show_pledge.operator_acted` | `pledgeId`, `campaignId`, `via` |
| Campaign update posted by an operator (community rooms) | `community_campaign_update.operator_posted` | `campaignId` |
| Artist benefit rules listed or changed by an operator | `community_benefit_rule.operator_managed` | `artistId`, `via` |

`admin_branch_audit_coverage.spec.ts` scans the backend for every comparison of a
role with admin or operator, per file, and fails when a count changes without a
decision (record it with `auditAdminBranch` and list the action, or list the
reason). It also checks that every audit action has a web label.

## Optional `/admin` network restriction (mechanism only)

See [Restricting the admin surface by network](../engineering/admin_network_restriction.md).
Documented, not adopted; adoption is a deployment task in `resonate-iac`.

## Admin routes (#2362)

Step-up gates the destructive actions only (takedowns, credit grants, recovery,
maintenance resets and reindexing, the removals and bans of community
moderation, and, since #2380, the four money-release operator actions. Everything else is audited without a prompt. `Detail` is ids, codes
and counts, never free text.

| Route | Audit action | Step-up |
| --- | --- | --- |
| `POST /admin/accounts/:userId/suspend`, `/close`; `/unsuspend` | `account.suspended`, `account.closed`; `account.unsuspended` | yes, yes; no |
| `POST /notices/broadcast`; `POST /notices/targeted` | `notice.broadcast_sent`; `notice.targeted_sent` | yes; no |
| `GET /admin/users/:id`; `/admin/agent-sessions/:id/events` | `user.detail_viewed`; `agent_session.events_viewed` | no |
| `POST /credits/grant` | `credits.granted` (recipient, `amountCents`) | yes |
| `POST /credits/requests/:id/grant` | `credit_request.granted` | yes |
| `POST /credits/requests/:id/dismiss`; `GET /credits/requests` | `credit_request.dismissed`; `credit_requests.viewed` | no |
| `POST /admin/entitlements/grants`; `DELETE /admin/entitlements/grants/:id` (#2406) | `entitlement_grant.created` (recipient, `grantId`, `plan`, `source`, `validUntil`); `entitlement_grant.revoked` (recipient, `grantId`, `plan`); never the admin's note | yes |
| `PATCH /api/dmca/:id/resolve` | `dmca.report_resolved` (`reportId`, `outcome`) | yes |
| `GET /api/dmca` | `dmca.reports_viewed` | no |
| `PATCH /management/recoveries/:id` | `management_recovery.reviewed` (`recoveryId`, `decision`) | yes |
| `GET /management/recoveries/pending` | `management_recovery.queue_viewed` | no |
| `POST /admin/retention/cleanup` | `maintenance.retention_cleanup_run` | yes |
| `POST /admin/erasure/run-due` | `maintenance.erasures_run` | yes |
| `DELETE /admin/wipe-releases` | `maintenance.releases_wiped` | yes |
| `PATCH /admin/community/moderation/reports/:reportId` | `community_moderation.report_resolved` (`reportId`, `action`) | yes |
| `GET /admin/community/moderation/reports` | `community_moderation.queue_viewed` | no |
| `POST /admin/stems/backfill-audio-features`, `/embeddings/backfill` | `maintenance.stem_features_backfill_run`, `maintenance.track_embeddings_backfill_run` | no |
| `POST /admin/analytics/warehouse/load`, `/backfill`; `/community/cohorts/generate` | `maintenance.analytics_warehouse_loaded`, `maintenance.analytics_warehouse_backfilled`, `maintenance.community_cohorts_generated` | no |
| `POST /metadata/indexer/reset`, `/indexer/reindex-tx` | `indexer.reset`, `indexer.tx_reindexed` | yes |
| `POST /wallet/guardians`, `/recovery/request`, `/recovery/approve` | `wallet.guardians_set`, `wallet.recovery_requested`, `wallet.recovery_approved` | yes |
| `POST /wallet/provider`, `/refresh`, `/paymaster`, `/paymaster/reset`, `/session-key` | `wallet.provider_set`, `wallet.refreshed`, `wallet.paymaster_configured`, `wallet.paymaster_reset`, `wallet.session_key_issued` | no |
| `POST /api/trust/:artistId/verify` | `trust.artist_verified` | no |
| `PATCH /catalog/credits/:creditId/identity` | `catalog_credit.identity_reviewed` | no |
| `GET /artists/claims/pending`; `PATCH /artists/claims/:claimId` | `artist_claims.viewed`; `artist_claim.reviewed` | no |
| `POST /shows/campaigns/:id/confirm-booking`, `/confirm-fulfillment`; `PATCH /shows/campaigns/:id/dispute/:disputeId/resolve` | `show_campaign.booking_confirmed`, `show_campaign.fulfillment_confirmed`; `show_dispute.resolved` (`campaignId`, `disputeId`, `outcome`) | yes (#2380) |
| Other Shows operator actions (`authority` approve, reject, revoke, expire; `resync-chain`; `discover-onchain`; `dispute`; reconciliation acknowledge and remove) | `show_authority.*`, `show_campaign.*`, `show_dispute.opened`, `show_reconciliation.*` | no |
| `POST /admin/x402-refunds/:id/mark-refunded`; `GET /admin/x402-refunds` | `x402_refund.marked_refunded`; `x402_refunds.viewed` | yes (#2380); no |
| Rights reassessments, trusted-source links, release rights requests (create, sample, review, revoke and their queues) | `rights_reassessment*`, `trusted_source_link*`, `release_rights_request*` | no |
| `GET /curation/reports` | `curation.reports_viewed` | no |
| `POST /agents/run`, `/orchestrate`, `/evaluate`, `/evaluate/golden`, `/runtime` | `agents.run_invoked`, `agents.orchestrated`, `agents.evaluated`, `agents.golden_eval_run`, `agents.runtime_run` | no |

Scheduled work cannot use the gated routes (a scheduler has no passkey): the
retention and erasure jobs run as Cloud Run job scripts that call the services
directly, and an admin route is manual by design (see `run_retention_cleanup.ts`).
The five maintenance backfills are cost-bearing but reversible, so they are audited
and not gated.

## Not covered

- Not audited on purpose (reason per route in `admin_audit_coverage.spec.ts`):
  the audit log's own reads, the users directory list and overview (opening a
  record is what is audited), aggregate status reads (pipeline health, backfill
  status, cohort quality, reconciliation mismatches, unclaimed refunds, paymaster
  status), session-key validation, and curator-role routes.
- Admin and operator branches inside user-facing routes are audited since #2380
  (table above). Deliberately left, with the reason in
  `admin_branch_audit_coverage.spec.ts`: the operator console's management read of
  a campaign (`GET /shows/campaigns/:id/manage`; it loads on every campaign page an
  operator opens, and each action taken from it is recorded on its own route); the
  AI DJ quality dashboard (aggregate counts, no person's data) and the `agent`
  analytics reader (automated, not a person); comparisons with the literal ids
  `"admin"` / `"operator"` in community rooms and the Discord bridge (a signed-in
  session carries a wallet-address id, so no role reaches them); the viewer
  capability flag in community rooms (grants no access); and role checks inside
  admin-only routes that `@AdminAudit` already records.
- Any future bulk admin action must add `@RequireStepUp()`.
- The audit log's own reads are not logged; no export of the log; actor-side
  export for an operator's own entries.
- A passkey-only ERC-1271 end-to-end check against a deployed smart account is
  covered by the shared verifier's existing behaviour, not by a new test here.
- Shows money-release actions and the x402 mark-refunded route are gated since
  #2380 (owner decision). The x402 route still has no admin screen.

## Tests

Backend: `admin_step_up.controller.http.spec.ts`, `admin_audit.controller.http.spec.ts`,
`admin_step_up_token.spec.ts`, `admin_step_up_routes.spec.ts`,
`admin_accounts.controller.http.spec.ts` and `notice.controller.http.spec.ts`
(403 without/with a stale proof, accepted with a fresh one),
`admin_step_up.integration.spec.ts`, `admin_audit.integration.spec.ts`. Web:
`adminStepUp.test.ts`, `adminAudit.test.ts`, `AuditLogView.test.tsx`,
`audit/pages.test.tsx`, and the help integrity test.

#2380: `admin_step_up_routes.spec.ts` (the four new routes), the step-up cases in
`shows.controller.http.spec.ts` and `x402-refund-reconciliation.controller.http.spec.ts`,
`admin_branch_audit_coverage.spec.ts`, `admin_branch_audit.integration.spec.ts`
(analytics, wallet read, route history, community benefit rules, show campaign),
and the audit cases in `wallet.controller.http.spec.ts`,
`metadata_collection.controller.http.spec.ts`,
`metadata_notifications.controller.http.spec.ts`,
`metadata_notify_listing.controller.http.spec.ts` and
`metadata_rights_admin_branches.controller.http.spec.ts`. Web:
`adminStepUpGatedActions.test.ts` (Shows money-release calls) and
`adminAudit.test.ts`.

#2362: `admin_audit_coverage.spec.ts` (every admin route is audited or excused),
`admin_step_up_routes.spec.ts` (the pinned gated set), the `step-up and audit`
cases in the credits, DMCA, management, maintenance, indexer, wallet, shows, trust
and x402 HTTP specs, `admin_audit_misc.controller.http.spec.ts` (metadata queues,
catalog, artist claims, agents, curation), `admin_audit_routes.integration.spec.ts`
(rows in a real Postgres). Web: `adminStepUpGatedActions.test.ts`.
