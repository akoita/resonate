# Platform notices

Status: `in-progress` — tracked in
[#2146](https://github.com/akoita/resonate/issues/2146) (child of #1777).

Revenue line: vision-neutral readiness infrastructure (`vision:keep`). There are
no fee, split, price or payout changes.

## What it is

Platform notices are messages that come from the platform itself. They are
separate from the product-event notifications that `NotificationService` fans
out (disputes, credits, listings).

- **Broadcast**: an operator sends one notice to everyone or to one role
  audience (`role:listener`, `role:artist`, `role:operator`, `role:admin`).
  The server stores a single `Notice` row and works out who sees it each time
  someone lists their notices. People who sign up after the send still see it.
  The `artist` audience means anyone with an artist profile, because artist
  sessions carry the `listener` role.
- **Targeted notice**: one `Notice` row per listed recipient
  (`audience = "user"`). Only that recipient can list it or mark it read.
- **Read state**: stored per person in `NoticeRead (noticeId, userId, readAt)`.
  Dismissing a banner marks the notice read.
- **Categories**: `policy`, `terms`, `incident`, `moderation`, `account`,
  `refund`.
- **Expiry**: an optional `expiresAt` hides a broadcast after that time.
  `effectiveAt` is for display only ("Takes effect ...") and does not filter
  anything.

Notices live in their own table rather than the wallet-keyed `Notification`
table. That table's read routes are keyed by a public wallet address, so it
cannot hold content that only one person may see.

## Server API (for other features)

`NoticeService` (`backend/src/modules/notifications/notice.service.ts`, exported
by `NotificationModule`):

- `sendTargeted({ userIds, category, title, body, link? }, actor, { dedupeKey? })`
  - The call accepts up to 1000 recipients. If any id is unknown, the whole call
    is rejected. With a `dedupeKey`, repeating the call for the same recipient
    creates nothing new. System callers pass `{ userId: "system:<source>" }`.
- `sendBroadcast({ audience, category, title, body, link?, effectiveAt?, expiresAt? }, actor)`
- `listForUser(userId, role)`: returns the person's targeted notices and the
  active broadcasts for their audience, newest first (up to 50), with `readAt`
  and `unreadCount`.
- `markRead(userId, role, noticeId)`: returns 404 unless the person can see the
  notice.

Every send writes a `notice.sent` audit record through `AuditService`. It holds
the actor, kind, category, and either the audience (broadcast) or the recipient
count (targeted). Targeted titles and bodies are never logged.

## HTTP routes

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /notices` | signed-in | The caller's notices and unread count |
| `POST /notices/:id/read` | signed-in | Mark read or dismiss |
| `POST /notices/broadcast` | `admin`, `operator` | Send a broadcast |
| `POST /notices/targeted` | `admin`, `operator` | Send targeted notices |
| `GET /notices/sent` | `admin`, `operator` | The latest 50 broadcasts with read counts |

Input is validated with 400 responses:

- `title`: 1–120 characters
- `body`: 1–2000 characters
- `category`: must be one of the categories above
- `audience`: must use the documented format
- `link`: must be an in-app path
- `expiresAt`: must be in the future
- `userIds`: 1–1000 entries

## Moderation notice

When an admin resolves a community moderation report with `delete_message`,
`remove_member` or `ban_member`, `NoticeService` handles the existing
`community.moderation_action_taken` event. It sends one targeted `moderation`
notice to the author of the reported message.

- The notice names the room and the action, and gives the reason category
  ("community guidelines").
- It never includes the reporter's words or the operator's note.
- It links to the User Guide article. There is no in-app appeal for community
  moderation yet, and the notice says so.
- It is keyed on the report id (`dedupeKey = community_moderation_report:<id>`),
  so a replayed event never sends a second notice.
- `no_action`, `pause_room` and `archive_room` send nothing.

## Takedown notice

When `DmcaService.resolveReport` upholds a report, the track becomes
`dmca_removed` and its stems are delisted. `NoticeService.notifyDmcaTakedown`
then sends one targeted `moderation` notice from the `system:dmca` actor.

- **Recipient:** the release's `managementOwnerUserId`, else the artist's
  `userId`. This is the owner rule `management-access.ts` uses. If neither
  exists, the notice is logged and skipped.
- **Copy:** names the track and release and gives the reason category,
  "copyright complaint". It never includes the complainant's name, email or
  written reason.
- **Where to respond:** a counter-notice cannot be filed from the app yet, and
  the notice says so and links to the User Guide article.
- **Idempotent:** keyed `dmca_report:<reportId>`, so resolving or replaying the
  report again sends nothing new.
- **Rejected reports** send nothing.
- **Failure handling:** a notice failure is logged and never fails the
  takedown.

## Web

- **Notification bell**: lists notices, each with a category chip.
- **Banner**: `PlatformNoticeBanner` sits in the app shell under the topbar. It
  shows the newest unread `policy`/`terms`/`incident` broadcast until the person
  dismisses it.
- **Operator page**: `/admin/notices` appears as "Notices" in the operator
  sidebar section. It covers category, audience and optional effective date,
  with a preview and a confirmation through the shared `ConfirmDialog`, plus the
  sent list.
- **User Guide**: `/help/platform-notices`.

## Privacy

- A **targeted** `Notice` is kept as a minimal record on erasure (#2167). What
  must be provable later is that a notice of a given category was sent on a
  given date, so `id`, `category`, `audience`, `createdAt`, `effectiveAt`,
  `expiresAt` and `dedupeKey` stay, and `recipientUserId` rotates by cascade.
  The text can be personal ("your track X was removed"), so `title` and `body`
  are replaced with a neutral placeholder ("Notice" / "Content removed when the
  account was deleted.") and `link` is cleared. The erasure manifest rule is
  `anonymize`, matched on `recipientUserId`.
- **Broadcasts** (`all`, `role:*`) have no recipient, name nobody and are
  untouched.
- `Notice.createdBy` is listed as a dangling column and is rewritten on
  erasure.
- `NoticeRead` is deleted on erasure.
- Targeted notices are included in the person's data export.

## Email delivery (backend)

Status: backend implemented (#2169). The deployment half (provider, secrets,
job schedule) is tracked outside this repository; until it is done no email
leaves a deployment, and the API reports `available: false`.

A person can add an optional **contact address** (separate from the account
email) to also receive notices by email. It is used only for platform notices
and is double opt-in: nothing is sent until the person confirms it from a link
mailed to the address (single use, 24 hours, replaced whenever the address
changes). `terms` and `account` notices are **required** and are always
emailed to a confirmed address; `policy`, `incident`, `moderation` and `refund`
can be turned off. Exported as `EMAIL_REQUIRED_NOTICE_CATEGORIES`.

How it works:

- `NoticeService` is unchanged. A scheduled job,
  `backend/src/scripts/run_email_deliveries.ts [--limit N] [--dry-run]`, does
  three bounded steps and logs counts only:
  1. **Fan-out**: each notice with `emailFannedOutAt = null` becomes one
     `EmailDelivery` row per eligible recipient (confirmed address, not erased,
     category required or not opted out). Targeted notices go to their
     recipient; broadcasts to `all`, `role:artist` (has an artist profile),
     `role:admin` / `role:operator` (allowlisted by user id, wallet or owner
     address) and `role:listener` (everyone not an allowlisted admin, operator
     or agent, matching the in-app audience). Expired broadcasts are skipped.
     The migration stamps every existing notice as fanned out, so history is
     never emailed. `(noticeId, userId)` is unique, so a replay sends nothing.
  2. **Send**: due rows are re-checked at send time (address still confirmed,
     category still enabled, else `suppressed`) and rendered from the notice.
     Transient failures retry after 5 minutes, 30 minutes, 2 hours and 12
     hours, then `failed` after 5 attempts. A permanent recipient rejection is
     treated as a hard bounce.
  3. **Prune**: delivery rows older than 180 days are deleted.
- **Bounces and complaints** disable the address (`disabledReason` =
  `hard_bounce` or `complaint`) and send the person one in-app `account` notice
  (`dedupeKey = email_disabled:<contactEmailId>:<disabledAt>`) asking them to
  fix the address. They arrive through the permanent-rejection path above or
  `POST /email/webhook`. Soft bounces are ignored.
- **Unsubscribe**: every optional-category email carries a link to the
  unsubscribe page and RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post`
  headers. Tokens are stateless HMAC-SHA256 over `{userId, category, v:1}`
  (`EMAIL_LINK_SIGNING_SECRET`). Required categories carry neither.
- **Transport** is provider-neutral (`EMAIL_TRANSPORT` = `log` | `smtp`,
  nodemailer for SMTP). See `docs/deployment/environment.md` for the variables.
  If email is not configured it is disabled, not an error.

Confirmation emails go to an address the person typed, so each account is
limited in `ContactEmailService` (not just by the per-IP `@Throttle`, which sits
behind the global throttle guard that runs before authentication): at least 60
seconds between sends and at most 5 per rolling 24 hours, for both `PUT` and
`resend`. The counters live on `User` (`confirmationSendCount`,
`confirmationWindowStartedAt`, `lastConfirmationSentAt`), so removing and
re-adding the address does not reset them; they are exported and cleared on
erasure. A refused send answers 429
`{ code: "email_rate_limited", retryAfterSeconds }`.

Routes (all `@AllowWhileSuspended` where they mutate, so a suspended person
stays reachable):

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /me/contact-email` | signed-in | State: `available`, `address`, `status`, `disabledReason`, `confirmationSentAt`, per-category `required` / `enabled` |
| `PUT /me/contact-email` | signed-in | Set or change the address and mail the confirmation; 503 `email_unavailable`, 502 `email_send_failed`, 429 `email_rate_limited` |
| `POST /me/contact-email/resend` | signed-in | Resend the confirmation for a pending address; 409 otherwise, 429 `email_rate_limited` |
| `DELETE /me/contact-email` | signed-in | Remove the address (204); works even when email is unavailable |
| `PUT /me/contact-email/preferences` | signed-in | `{ optOuts: string[] }`; required categories are rejected with 400 |
| `POST /email/confirm` | public | `{ token }`; 400 `invalid_or_expired` |
| `POST /email/unsubscribe` | public | `{ token }`; idempotent; 400 `invalid` |
| `POST /email/unsubscribe/one-click?token=` | public | RFC 8058 one-click; body ignored |
| `POST /email/webhook` | HMAC signature | Normalised bounce / complaint events; 401 bad signature, 503 secret unset |

## Email notices (web)

Status: `partial` — web half of
[#2169](https://github.com/akoita/resonate/issues/2169). Real delivery is
verified on staging separately, so the feature stays partial until then.

Revenue line: vision-neutral readiness infrastructure. Nothing here touches
fees, splits, prices or payouts, and the address is never used for marketing.

**Settings → Email notices** (`/settings?section=email`,
`components/settings/EmailNoticesPanel.tsx`) manages an optional contact
address, separate from the account's own email. It reads and writes
`/me/contact-email` and has five states:

| State | What the person sees |
| --- | --- |
| Unavailable | A short note that email notices are not available on this deployment, and notices still arrive in the app. An address saved earlier can still be removed. |
| None | The promise ("Used only for platform notices. Never for marketing."), an address field and **Send confirmation**. |
| Pending | The address, "Check your inbox", **Resend confirmation**, **Change address** and **Remove**. |
| Confirmed | The address, **Change address**, **Remove**, and a toggle per category. |
| Disabled | Why sending stopped (bounce or complaint), and a form for a different address. |

- **Required categories.** `terms` and `account` are always emailed to a
  confirmed address. They show a locked, checked toggle, a "Required" label and
  a one-line reason. Only optional categories are sent as opt-outs; the client
  never includes a required category in the list.
- **Remove** asks first, through the shared `ConfirmDialog`.
- **Errors** map the server's `code` to plain sentences:
  `email_unavailable`, `email_send_failed`, `invalid_or_expired` and `invalid`.
  A per-account confirmation limit (`email_rate_limited`) says how many
  minutes to wait. A failed send
  re-reads the state, because the server keeps the address pending so Resend
  works.
- **`/email/confirm?token=`** confirms once on load (no sign-in needed) and
  shows success with a link to Settings, or an expired/used message with a link
  to Settings to ask for a new link.
- **`/email/unsubscribe?token=`** shows a **Stop these emails** button and calls
  the API only after the click, so mail scanners and link previews cannot
  unsubscribe anyone. It then names the category that was turned off.
- Both pages are `noindex` and set `referrer: no-referrer` so the token does not
  travel in a `Referer` header. They read `searchParams` as a promise, as this
  Next.js version requires.
- **Client code:** helpers and types in `lib/api.ts` (`getContactEmail`,
  `setContactEmail`, `resendContactEmailConfirmation`, `removeContactEmail`,
  `setContactEmailPreferences`, `confirmContactEmail`, `unsubscribeEmail`);
  wording and small rules in `lib/contactEmail.ts`.
- **Tests:** `lib/contactEmail.test.ts`, `EmailNoticesPanel.test.tsx`,
  `components/email/EmailLinkPages.test.tsx`, `app/settings/page.test.tsx`.
- **User Guide:** the "Get notices by email" section of `/help/platform-notices`.

## Remaining

- Email delivery is implemented in the backend (above); the provider, secrets
  and job schedule are a deployment task, and a provider-specific webhook
  adapter is needed if the chosen provider cannot sign the normalised contract.
  Other outbound channels (push, chat) are not covered.
- An appeal path for community moderation.
- An in-app DMCA counter-notice path. The API route exists; there is no UI.
- There is no operator UI for targeted sends yet; the route exists.
- No WebSocket push: notices refresh on a 45 s poll and when the bell opens.
