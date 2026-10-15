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

## Remaining

- Email and other outbound transport (outbound-channel issue).
- Account suspension (#2147) and refund reminders (#2149) will call
  `sendTargeted`.
- An appeal path for community moderation.
- An in-app DMCA counter-notice path. The API route exists; there is no UI.
- There is no operator UI for targeted sends yet; the route exists.
- No WebSocket push: notices refresh on a 45 s poll and when the bell opens.
