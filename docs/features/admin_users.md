# Admin users directory and user detail

Status: `in-progress` — tracked in
[#2166](https://github.com/akoita/resonate/issues/2166). The web half and the
backend half ship together on the same issue; the status stays `in-progress`
until the staging check passes and the follow-ups below are tracked.

Revenue line: vision-neutral operations/readiness (`vision:keep`). There are no
fee, split, price or payout changes.

## What it is

A place for admins and operators to see who uses Resonate, find one person, check
when they last used the app and what they have done, and open their record. It
sits in the `/admin` section of the same app. The server is the security
boundary: every route is `@Roles("admin", "operator")` behind `AuthGuard("jwt")`.

## Surfaces

- **`/admin/users`** (admins and operators): overview tiles, a search box,
  filters (status, role, activity, sort, order), a paginated table, and a link
  from each row to the record. The filters are in the URL query, so a view can
  be shared and the back button works. On a phone each row becomes a card.
- **`/admin/users/[id]`** (admins and operators): identity (user id, wallet
  address, owner address, account type, network, passkeys, joined, last
  sign-in, last active day), account status, activity (counts and the latest
  five purchases, pledges and releases, notices received) and the list of
  operator actions on the record (newest 20).
- **Restriction controls** (suspend, lift, close) appear on the record **only
  for admins**. They are the existing #2147 controls
  (`AccountRestrictionPanel`) calling the existing admin-only
  `/admin/accounts/*` routes; operators see the status read-only. Those routes
  are not widened to operators.
- The sidebar shows a **Users** link to admins and operators; the top bar
  titles the page "Users".
- `/help` article `admin-users` (audience operator, status `partial`).

- **Possible duplicate chip** (#2180): a small "Possible duplicate" chip on a row
  and on the record's header when another account's id equals this one apart
  from letter case. Wallet-account ids are lowercase addresses; before ids were
  normalised at every creation point, a checksummed spelling of the same address
  could create a second account. The server computes the flag for the whole page
  in one query (`possibleDuplicate` on each row and on the record). It is
  information only: nothing is merged or changed from this screen. Operators
  review candidates with the read-only report script described in the
  [case-variant user ids runbook](../operations/case_variant_user_ids_runbook.md).

States: loading skeleton, empty directory, "no one matches these filters" with
a clear action, a page past the end, an error with retry, and a `403` shown as
"Admins and operators only". An unknown or erased user shows "User not found".

## API contract (web half)

All under `/admin/users`. The web client lives in `web/src/lib/api.ts`
(`getAdminUsersOverview`, `listAdminUsers`, `getAdminUser`,
`buildAdminUsersQueryString`) and the URL/filter/format helpers in
`web/src/lib/adminUsers.ts`.

- `GET /admin/users/overview` — totals, new users in 7/30 days, active users in
  1/7/30 days, suspended and closed counts.
- `GET /admin/users` — query `q`, `status`, `role`, `activeWithinDays`,
  `inactiveForDays`, `sort`, `order`, `page`, `pageSize`; returns
  `{ items, page, pageSize, total }`. The page asks for 25 per page and sends
  at most one of the two activity filters.
- `GET /admin/users/:id` — the record. The server writes one audit event per
  successful call.

Purchases and pledges carry `assetSymbol` and `assetDecimals`; amounts are
base-unit strings and the UI shows them as "4.5 USDC" / "0.0012 ETH". The
record's `status.accountStatus` is the effective status (an expired suspension
reads as active) and `status.scheduledErasureAt` is the due date of a pending
account closure, shown in the restriction panel.

The UI never shows or asks for an email address: `User.email` holds placeholders
for wallet accounts, and a confirmed contact address is added separately
(#2169). Last active is shown to the day only; activity is recorded at most once
an hour per person.

## Privacy and audit

Opening a record is logged server-side (`AdminAuditEvent`), as is every
suspension, lift and closure; internal notes are never stored in that log. The
help article and the page tell operators this. The collection of last sign-in and
last activity, its legal basis and its retention are covered by the backend half
(privacy policy and personal-data inventory).

## Tests

`web/src/lib/api.adminUsers.test.ts`, `web/src/lib/adminUsers.test.ts`,
`web/src/app/admin/users/UsersView.test.tsx`,
`web/src/app/admin/users/[id]/UserDetailView.test.tsx`,
`web/src/app/admin/users/pages.test.tsx`, and the help content integrity test
`web/src/lib/help/help.test.ts`. The backend specs are listed with the backend
half of #2166.

## Remaining

- Staging check of the directory and record against the real backend, then move
  the help article from `partial` to `available`.
- A confirmed contact address on the record (#2169) and an export of the
  directory.
- Extending the audit log to every admin action with step-up confirmation
  (#2173).
- A screenshot for the help article, once the screen can be captured against a
  seeded backend.

See also [Account suspension and closure](account_suspension.md).
