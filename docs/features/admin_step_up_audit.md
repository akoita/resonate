# Admin step-up confirmation and the admin audit log

Status: `in-progress` — tracked in
[#2173](https://github.com/akoita/resonate/issues/2173) (Sprint 41). The core is
implemented; the "Not in this slice" list below is what remains.

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
  Routes today: `POST /admin/accounts/:userId/suspend`, `/close` and
  `POST /notices/broadcast`. Lifting a suspension only restores access and does
  not need it; targeted notices are audited but not gated. Pinned by
  `admin_step_up_routes.spec.ts`.
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
  actions), `admin.step_up_verified`, `admin.step_up_refused` (`denied`).
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
Wired into `AccountRestrictionControls` (suspend, close) and the notices page
(broadcast). `/help` article `admin-users` covers it.

## Optional `/admin` network restriction (mechanism only)

See [Restricting the admin surface by network](../engineering/admin_network_restriction.md).
Documented, not adopted; adoption is a deployment task in `resonate-iac`.

## Not in this slice

- Other admin-role routes (curation, DMCA, trust, shows, credits, catalog,
  management recovery, maintenance) are neither audited in `AdminAuditEvent` nor
  step-up gated. Each can adopt `@RequireStepUp()` and `writeAdminAuditEvent`.
- Any future bulk admin action must add `@RequireStepUp()`.
- The audit log's own reads are not logged; no export of the log; actor-side
  export for an operator's own entries.
- A passkey-only ERC-1271 end-to-end check against a deployed smart account is
  covered by the shared verifier's existing behaviour, not by a new test here.

## Tests

Backend: `admin_step_up.controller.http.spec.ts`, `admin_audit.controller.http.spec.ts`,
`admin_step_up_token.spec.ts`, `admin_step_up_routes.spec.ts`,
`admin_accounts.controller.http.spec.ts` and `notice.controller.http.spec.ts`
(403 without/with a stale proof, accepted with a fresh one),
`admin_step_up.integration.spec.ts`, `admin_audit.integration.spec.ts`. Web:
`adminStepUp.test.ts`, `adminAudit.test.ts`, `AuditLogView.test.tsx`,
`audit/pages.test.tsx`, and the help integrity test.
