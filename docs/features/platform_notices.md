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
count (targeted). Targeted titles and bodies are never logged. Since #2173 an
operator-sent notice also writes a durable `AdminAuditEvent`
(`notice.broadcast_sent` / `notice.targeted_sent`; notices the platform sends
itself under a `system:` actor are not logged there), and a broadcast needs a
fresh step-up proof (see [Admin step-up and audit log](admin_step_up_audit.md)).

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
  fix the address. They arrive through the permanent-rejection path above,
  `POST /email/webhook`, or the SNS adapter below. Soft bounces are ignored.
  A replay changes nothing: an address that is already disabled is not
  disabled again, so no second notice is sent.
- **SNS adapter** (#2177): providers that cannot sign the normalised webhook
  contract publish events to an SNS-compatible topic, which POSTs to
  `POST /email/webhook/sns/:token`.
  - *Authentication* is the path token (`EMAIL_SNS_WEBHOOK_TOKEN`, at least 32
    characters), compared in constant time. A wrong token, or a route that is
    not configured, answers 404 so the route stays hidden. SNS message
    signatures are not verified yet: the supported provider does not document
    how to verify them. Treat the token as a secret. The API's own request log
    writes the path as `/email/webhook/sns/:token`; platform access logs in
    front of the API are a deployment concern.
  - The envelope's `TopicArn` must equal `EMAIL_SNS_TOPIC_ARN` (403 otherwise).
  - *Subscription confirmation*: `SubscribeURL` is never fetched as given. It
    must be HTTPS on the default port with no credentials, its host must be
    listed exactly in `EMAIL_SNS_CONFIRM_HOSTS`, and it must be
    `Action=ConfirmSubscription` for the configured topic with a token. The
    request is then rebuilt from the configured host and topic, so only the
    subscription token comes from the message. It follows no redirects and
    times out after 5 seconds. Anything else answers 400 without a request
    (no SSRF).
  - *Notifications*: `Message` is parsed by the mapper `EMAIL_SNS_EVENT_FORMAT`
    selects. The only format today is `scaleway-tem`: `email_dropped`,
    `email_mailbox_not_found` and a `mailbox_not_found` blocklist event are
    hard bounces, `email_spam` is a complaint, and delivered, queued, deferred
    and other events are counted as ignored (the provider retries deferred
    mail and publishes a drop if it finally fails). Mapped events go through
    the same hard-bounce and complaint path as `POST /email/webhook`.
  - The body is read whether it arrives as `text/plain` (usual for SNS) or
    `application/json`, and requests without an `Origin` header are accepted.
- **Unsubscribe**: every optional-category email carries a link to the
  unsubscribe page and RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post`
  headers. Tokens are stateless HMAC-SHA256 over `{userId, category, v:1}`
  (`EMAIL_LINK_SIGNING_SECRET`). Required categories carry neither.
- **Transport** is provider-neutral (`EMAIL_TRANSPORT` = `log` | `smtp`,
  nodemailer for SMTP). See `docs/deployment/environment.md` for the variables.
  If email is not configured it is disabled, not an error.

### Deliverability

Notice and confirmation emails are built to read as legitimate transactional
mail rather than a bare sentence and a link:

- **Content**: a plain, table-based HTML part and a matching plain-text part
  (same wording, same links). Each has the product name, a heading, one or two
  sentences saying what the email is and why the person received it, a button
  plus the full link written out underneath, and a footer with the email
  settings link, the privacy policy link and, for optional categories, the
  unsubscribe link. The confirmation email also states that the link works once,
  expires in 24 hours, and that nothing is sent if it was not requested. No
  remote images, tracking pixels, link shorteners or scripts; every
  operator-authored value is HTML-escaped.
- **Subjects**: notices are `[Resonate] <title>`, cut to about 78 characters,
  one line.
- **Headers**: every SMTP message gets an explicit `Message-ID` on the domain of
  `EMAIL_FROM`, and the SMTP greeting (EHLO) name is that same domain instead of
  the container's hostname. `Reply-To` is added when `EMAIL_REPLY_TO` is set.
  Optional categories keep the RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post`
  headers. `EMAIL_FOOTER_TEXT` adds an operator line (name, address) to the
  footer when set.
- **Not code**: a new sending domain starts with no reputation, so its first
  messages may land in spam until mailbox providers see consistent,
  wanted mail. Authentication of the sending domain (SPF, DKIM, DMARC) and
  the reverse DNS of the sending host are deployment configuration, not part of
  this repository.
- **Misconfigured audiences**: a broadcast to `role:admin`, `role:operator` or
  `role:listener` depends on the role allowlists. When the allowlist it needs
  is empty (for `role:listener`, when all three are empty) the job logs one
  `email.deliveries.audience_unresolvable` warning per run (notice count and
  audience names only) and reports `audienceUnresolvable` in its run summary,
  so an empty-looking run can be told apart from a job missing its
  configuration. The notice is still marked as fanned out.

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
| `POST /email/webhook/sns/:token` | path token | SNS-compatible bounce / complaint events (#2177); 404 off or wrong token, 403 other topic, 400 malformed or non-allowlisted confirmation URL, 502 confirmation failed |

## Email notices (web)

Status: `implemented` — web half of
[#2169](https://github.com/akoita/resonate/issues/2169). Real delivery was
verified end to end (confirmed address, then an admin notice through the
sender), and #2169 is closed.

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

## Optional email prompts (web)

Status: `implemented` for the four prompts below
([#2182](https://github.com/akoita/resonate/issues/2182), follow-up to #2169).

Revenue line: vision-neutral readiness infrastructure (ADR-BM-6). No fee,
split, price or payout change.

Email stays **optional**: Resonate is wallet-first, so no role is ever required
to add one. Instead a small card offers it where it clearly helps
(`components/email/EmailPromptCard.tsx`, rules and words in `lib/emailPrompt.ts`).
It is a dismissible card, never a modal or a gate.

| Moment | Where | Card |
| --- | --- | --- |
| `onboarding` | Home, right under the hero | "Want important notices by email too? Refunds owed, account decisions, terms changes." **Add an email** opens the address form in place (with the wallet-link disclosure); **Skip** is one tap. |
| `pledge` | Shows campaign page, after a pledge is confirmed | "Get an email if a refund is ever owed to you." Links to Settings → Email notices. |
| `artist_listing` | Listing Manager, once the seller has a first listing (any state, sold included) | Account notices by email. Links to Settings. |
| `stale_notices` | Top of the notification bell, when an unread `account` or `refund` notice is at least 3 days old (`STALE_NOTICE_DAYS`) | "Missed a notice? Get these by email too." Links to Settings. |

- **When it shows.** Only for a signed-in person, only when email is configured
  on the deployment (`available`), only while they have no address on file (a
  pending, confirmed or stopped address is never prompted again), and only if
  they have not dismissed that moment. Nothing blocks, and nothing is requested
  once a prompt was dismissed.
- **Dismissal** is stored in this browser's `localStorage`, per account and per
  moment (`resonate.emailPrompt.dismissed.<userId>.<context>`), because the
  server has no preference field for it. If storage cannot be read the prompt
  stays hidden. A person who clears site data, or uses another browser, may be
  asked once more.
- **Onboarding reuses the Settings flow.** The inline form calls the same
  `/me/contact-email` endpoint, so it is the same double opt-in (nothing is
  emailed until the link is opened) and the same errors.
- **Measurement** (counts only, never the address, and only with analytics
  consent, through the existing `recordProductAnalytics` gate) reuses the
  `onboarding.step_viewed` (prompted), `onboarding.step_completed`
  (`action: address_added` or `opened_settings`) and `onboarding.abandoned`
  (dismissed) events with `flow: "email_notices"` and `step: <moment>`. Confirmed
  addresses are counted from the server's own `ContactEmail` records, because the
  confirmation link has no session.
- **Tests:** `lib/emailPrompt.test.ts` (show/hide/dismiss rules, onboarding skip,
  stale-notice selection), `components/email/EmailPromptCard.test.tsx` (each
  state).
- **User Guide:** the "Get notices by email" section of `/help/platform-notices`.
- **Not done:** a prompt when an account-status decision banner is shown (the
  bell prompt covers unread account notices after 3 days), and a server-side
  dismissal field (which would need a schema change).

## Remaining

- Email delivery is implemented in the backend (above); the provider, secrets
  and job schedule are a deployment task. Providers that cannot sign the
  normalised contract use the SNS adapter (#2177); verifying SNS message
  signatures, as a second layer behind the path token, waits for a documented
  scheme from the provider. Other outbound channels (push, chat) are not
  covered.
- An appeal path for community moderation.
- An in-app DMCA counter-notice path. The API route exists; there is no UI.
- There is no operator UI for targeted sends yet; the route exists.
- No WebSocket push: notices refresh on a 45 s poll and when the bell opens.
