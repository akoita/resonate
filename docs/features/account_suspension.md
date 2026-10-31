# Account suspension and closure

Status: `in-progress` — tracked in
[#2147](https://github.com/akoita/resonate/issues/2147) (child of #1777, gap 1);
listening while suspended in
[#2167](https://github.com/akoita/resonate/issues/2167).

Revenue line: vision-neutral readiness (`vision:keep`). There are no fee, split,
price or payout changes.

## What it is

An operator (admin role) can suspend or close a person's account. The state is
enforced on the server, and the person is told why.

- **States**: `active`, `suspended` (reason category, optional end date) and
  `closed`. They live on `User` (`accountStatus`, `accountStatusReason`,
  `accountStatusUntil`, `accountStatusChangedAt`, `accountStatusChangedBy`).
- **Reason categories**: `terms_violation`, `fraud`, `abuse`,
  `rights_infringement`, `other`. The operator's free-text note is stored only in
  the audit record and is never shown to the person.
- **Lazy expiry**: a suspension past its end date counts as active on the next
  read; the stored row is flipped back opportunistically.

## Enforcement

One global interceptor, `AccountStatusInterceptor` (registered as
`APP_INTERCEPTOR` in `AppModule`), refuses every `POST`/`PUT`/`PATCH`/`DELETE`
from an authenticated suspended or closed account with `403`
`{ code: "account_suspended" | "account_closed", until?, message }`. It is an
interceptor and not a global guard because Nest runs global guards before the
route's `AuthGuard("jwt")`, so `request.user` is not set yet at guard time.

- `GET`/`HEAD` are never blocked: the person can read their own data.
- Status reads are cached per user for 30 seconds and the entry is dropped when
  this process changes the status. On a multi-instance deployment another
  instance can lag by up to 30 seconds.
- **Allowlist**: handlers marked `@AllowWhileSuspended()` are never blocked.
  `account_status_allowlist.spec.ts` pins the exact set: sign-in
  (`AuthController`), the Shows refund confirmation
  (`POST /shows/pledges/:id/refund/confirm`), every privacy route (data export
  and account closure request/cancel), `POST /notices/:id/read`, the
  notification read routes, and the listening routes below. A suspension never
  traps a person's money.
- An operator closure with scheduled erasure cannot be cancelled by the person:
  `AccountClosureService.cancel` (used by sign-in and the cancel route) does
  nothing for a `closed` account.

### Listening while suspended (#2167)

Suspension exists to stop abuse of participation; listening harms no one. So a
suspended or closed account can keep playing, but **its plays do not count**.
Purchases, uploads, listings, pledges and posting stay blocked.

- **Allowed** (`@AllowWhileSuspended()`, pinned by `account_status_allowlist.spec.ts`):
  the player telemetry routes (`POST /analytics/playback/event` and
  `/analytics/playback/completed`), DJ session start/stop/next
  (`POST /agents/config/session`, `/agents/config/session/stop`,
  `/sessions/start`, `/sessions/stop`, `/sessions/agent/next`) and the
  playback-intent routes (`/sessions/playback/{device,resolve,queue,play,control,commands/:id/confirm}`).
  Audio is served by `GET`, which is never blocked.
- **Still refused**: priced session play (`POST /sessions/play`, an agent
  purchase), playback capability grants, `POST /analytics/ingest`,
  `/analytics/product/event` and `POST /agents/config/signals`.
- **Not counted**: `AnalyticsInstrumentationService.recordPlaybackCompleted`,
  `recordPlaybackLifecycle` and `recordProductEvent` (for `playback.*` names)
  drop the event when the actor's account is not active, before anything is
  written. That is the one place a play becomes a `playback.*` fact (which feeds
  discovery popularity, artist engagement, first-listener reception, home-feed
  and Scene Scout inputs), a taste/learning signal (`AgentSignal`) and any
  future payout signal. The route answers `201` with
  `{ status: "skipped", reason: "account_restricted" }` so the player keeps
  working. There is no per-track or per-release play counter in the schema: all
  counts derive from those facts.
- The status read is the same 30-second cache the interceptor uses
  (`AccountStandingService`, a dependency-free read split out of
  `AccountStatusService` so analytics can use it without an import cycle). A
  play right after a suspension can therefore still count on another instance
  for up to 30 seconds.
- Plays already recorded before the suspension are not removed; this is a
  forward-looking rule.

### Artist Pro billing (#2430)

- **Suspension pauses collection** at Stripe (`pause_collection`, behavior
  `void`, resuming at the suspension's end when it has one): invoices due
  during a suspension are voided, so a suspended person is not charged.
  Lifting it resumes collection. The audit record carries
  `billingCollection: paused | resumed | deferred | none`.
- **Closure cancels the subscription immediately**; the audit record carries
  `subscription: canceled | pending | none`. A Stripe failure never blocks the
  status change: the retention job retries it. See
  [Artist Pro billing](artist_pro_billing.md#account-closure-erasure-and-suspension-2430).

### Known limits

- The HTTP API only. A transaction the person signs directly with their own
  wallet never reaches the backend, so this is a platform-level restriction, not
  an on-chain one.
- WebSocket events are not covered.
- The platform `AuditService` is in-memory plus structured logs; the durable
  operator trail is the `AdminAuditEvent` log (#2166, consolidated by #2173, see
  [Admin step-up and audit log](admin_step_up_audit.md)).
- Suspending and closing (not lifting) need a fresh step-up proof (#2173).

## API

Admin only (`@Roles("admin")` with `AuthGuard("jwt")`):

- `GET /admin/accounts/:userId/status` (`:userId` is a user id or wallet address)
- `POST /admin/accounts/:userId/suspend` `{ reason, until?, note? }`
- `POST /admin/accounts/:userId/unsuspend` `{ note? }`
- `POST /admin/accounts/:userId/close` `{ reason, note?, scheduleErasure? }`;
  `scheduleErasure` uses the existing account-closure request (#1771) with its
  normal 30-day grace period.

An admin cannot change their own account or another admin/operator address
(`ADMIN_ADDRESSES`, `OPERATOR_ADDRESSES`): `403`. A closed account cannot be
suspended again (`409`).

Signed-in person: `GET /account/status` returns their own state (and the date of
any operator-scheduled erasure) for the app banner.

## Notice

Each change sends one targeted `account` notice (`NoticeService.sendTargeted`,
`dedupeKey = account_status:<userId>:<changedAt>`). It names the reason
category and any end date, says what still works, and explains how to appeal
(contact support; no in-app appeal yet). It links to the `/help/account-suspension`
article.

## Web

- A persistent banner under the topbar for suspended and closed accounts
  (`AccountStatusBanner`); the self-service deletion banner is hidden for an
  operator-closed account.
- The shared API error formatter maps the `403` code to a plain sentence.
- The controls live on a person's record in the users directory
  (`/admin/users/[id]`, admins only; operators see the status read-only):
  reason select, optional end date, internal note, and `ConfirmDialog` for
  suspend, lift and close. Find the person with the directory search (user id
  or wallet address). See
  [Admin users directory and user detail](admin_users.md) (#2166).
- The former standalone `/admin/accounts` lookup page folded into Users; the
  URL redirects to `/admin/users`.

## Privacy manifests

The new columns are covered by the export manifest (`accountStatusChangedBy` is
redacted) and the erasure manifest (status retained on the anonymized row;
`accountStatusChangedBy` is a dangling operator id that is rewritten).

## Tests

`account_suspension.integration.spec.ts`, `admin_accounts.controller.http.spec.ts`,
`account_status_allowlist.spec.ts`, `suspended_listening.integration.spec.ts`,
the two privacy manifest specs,
`accountStatus.test.tsx`, `AccountRestrictionPanel.test.tsx`.

## Remaining

- Operator reopen of a closed account and a suspension queue/list view.
- An in-app appeal flow.
