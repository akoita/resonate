# Contact support and service status

Status: `done` — [#2667](https://github.com/akoita/resonate/issues/2667)
(Vision Sprint 59 "Clear for newcomers").

Revenue line: vision-neutral operations. No fee, split, price or payout change.

## What it is

- **Contact support** (`/support`): a short public form (topic, message, an
  optional reply address). Signed in, the request is linked to the account and
  answered at the person's confirmed contact address unless they give another.
  Signed out, the reply address is optional: without one, nobody can answer.
- **Operator queue** (`/admin/support`): requests newest first, filtered by
  status `new`, `answered` or `closed`, with the reply address and a link to
  the account. Operators answer from their own mailbox and mark the request.
- **Service status**: an `incident` broadcast to everyone. The notices composer
  (`/admin/notices`) offers three templates (slow or partly down, outage,
  resolved; resolved ends by itself after 24 hours), and every active sent
  broadcast has **End now**. The newest active incident broadcast to everyone
  is also shown, without a session, on the sign-in screen (`AuthGate`).
- Entry points: the footer (`LegalFooter`), Settings → Troubleshooting, the
  User Guide article `contact-support`, and the status line itself.

## Backend

| Route | Access | Notes |
| --- | --- | --- |
| `POST /support/requests` | public (`OptionalJwtAuthGuard`) | Class DTO; 10 per hour per IP; 5 per day per account, or per reply address when signed out (`429 support_rate_limited`); honeypot `website`. Sends a receipt with the reference (never the message) when an address is known and email is configured. |
| `GET /admin/support/requests?status=` | admin, operator | `@AdminAudit("support.requests_viewed")`; returns status counts. |
| `PATCH /admin/support/requests/:id` | admin, operator | `{ status }`; `@AdminAudit("support.request_status_changed")` with the id and status only. |
| `GET /notices/status` | public | `{ status: null \| { id, title, body, link, createdAt } }`: only what every signed-in person already sees in the banner. |
| `POST /notices/:id/end` | admin, operator | Sets `expiresAt` to now on a broadcast; `@AdminAudit("notice.broadcast_ended")`. |

Model `SupportRequest` (migration `20261126120000_support_requests`): `userId?`
(cascade), `email?`, `topic`, `message`, `status`, `statusChangedAt`,
`statusChangedBy`. Signed-in requests are in the personal data export and are
deleted on erasure. Requests sent signed out are not linked to any account.

The contact address shown on `/support` comes from the existing
`NEXT_PUBLIC_OPERATOR_CONTACT_EMAIL`; nothing is hard-coded.

## Tests

- `backend/src/tests/support.integration.spec.ts`: storage, receipts, honeypot,
  daily caps (account and address, case-insensitive), operator list and status,
  public status line and ending a broadcast.
- `backend/src/tests/support.controller.http.spec.ts` and
  `notice.controller.http.spec.ts`: public and role-restricted access, `400`
  validation, audit records.
- `web/src/lib/supportForm.test.ts`, `web/src/app/admin/notices/NoticeComposer.test.tsx`.

## Not included

- Answering inside the app (operators answer by email).
- Erasure of a signed-out request by email address on request: handled by an
  operator by hand.
