# Account suspension and closure

Status: `in-progress` — tracked in
[#2147](https://github.com/akoita/resonate/issues/2147) (child of #1777, gap 1).

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
  and account closure request/cancel), `POST /notices/:id/read`, and the
  notification read routes. A suspension never traps a person's money.
- An operator closure with scheduled erasure cannot be cancelled by the person:
  `AccountClosureService.cancel` (used by sign-in and the cancel route) does
  nothing for a `closed` account.

### Known limits

- The HTTP API only. A transaction the person signs directly with their own
  wallet never reaches the backend, so this is a platform-level restriction, not
  an on-chain one.
- WebSocket events are not covered.
- Music playback sessions are `POST` routes and are blocked like other writes.
- The audit service is in-memory plus structured logs, as for every other
  audited action; the durable record is `accountStatusChangedBy` and the notice.

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
- `/admin/accounts` (admins): lookup by user id or wallet address, reason select,
  optional end date, internal note, and `ConfirmDialog` for suspend, lift and
  close.

## Privacy manifests

The new columns are covered by the export manifest (`accountStatusChangedBy` is
redacted) and the erasure manifest (status retained on the anonymized row;
`accountStatusChangedBy` is a dangling operator id that is rewritten).

## Tests

`account_suspension.integration.spec.ts`, `admin_accounts.controller.http.spec.ts`,
`account_status_allowlist.spec.ts`, the two privacy manifest specs,
`accountStatus.test.tsx`, `AccountRestrictionPanel.test.tsx`.

## Remaining

- Operator reopen of a closed account and a suspension queue/list view.
- An in-app appeal flow.
- Durable (database) audit log for operator actions.
