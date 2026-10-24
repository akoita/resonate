# Operator view of an AI DJ session's raw agent events

Status: `implemented` for the lookup-by-id view — tracked in
[#2259](https://github.com/akoita/resonate/issues/2259). Remaining slices are
listed under "Not in this slice".

Revenue line: vision-neutral operations/quality infrastructure (`vision:keep`).
There are no fee, split, price or payout changes (ADR-BM-4 untouched).

## What it is

When an AI DJ session misbehaves ("it played the wrong thing", "it ignored what I
asked for"), an admin needs to see what the DJ actually decided without reading
logs. `/admin/agent-sessions` takes a session id and
`/admin/agent-sessions/[sessionId]` lists the session's agent events in order:
the candidate selection, each pick (position, track, license, reason code, which
curator chose it), runtime fallbacks, shortfalls, and how many picks matched the
listener's request (coverage).

## Design (Sprint 39 decision, overridable)

- **No new store.** The view reads the analytics events the runtime already
  records: `AnalyticsEvent` rows whose `eventName` starts with `agent.` and
  whose `sessionId` is the session. An index on `(sessionId, occurredAt)` makes
  that a cheap read.
- **Retention follows the analytics retention policy.** The events are
  `pseudonymous`-tier, so they expire after `ANALYTICS_RETENTION_PSEUDONYMOUS_DAYS`
  (default 730) like every other analytics event; the page states that period.
  The audit log below is separate and is kept as audit history.
- **Admin only.** `GET /admin/agent-sessions/:sessionId/events` is
  `@Roles("admin")` behind `AuthGuard("jwt")`; the global `RolesGuard` enforces
  it. Unlike the users directory, an operator role gets `403`.
- **Every read is audited.** A successful read writes an `AdminAuditEvent`
  (`agent_session.events_viewed`, `targetUserId` = the session owner when the
  session still exists, `detail` = `{ sessionId, eventCount }`) **before** the
  events are returned; if the audit write fails the request fails. The entry
  also shows under "Operator activity on this record" on the owner's
  `/admin/users/[id]`. An unknown session (`404`) or a malformed id (`400`)
  returns nothing and writes nothing.
- **Order.** Oldest first by `occurredAt`; events with the same timestamp (the
  12 per-pick `agent.decision_made` events of one session start, #2317) follow
  `pickIndex`, then storage order. At most 500 events are returned; the oldest
  500 are shown and `truncated` is set when there are more.

## Privacy note: what is shown

The response is built **field by field from a whitelist** (the payload is never
passed through), so a typed sentence or any other free text in a stored payload
cannot reach the screen even if an emitter put it there.

Shown: event name and time, identifiers (`trackId`, `artistId`, `releaseId`,
`listingId`, `tokenId`), reason / strategy / curator / license / status codes
(lowercase tokens only), counts (`pickIndex`, `pickCount`, `trackCount`,
`shortfall`, candidate count, `latencyMs`, price), the categorical runtime
fallback, which parts of the request could not be filled (`genres`, `mood`,
`energy` — the names, not the values), and the coverage (filter keys, counts,
held-back counts, relaxed-cap artist count, `catalog_short`).

Never shown: what the listener typed, the LLM's `reasoning`, the pre-rendered
`coverageSummary`, track titles, the artist named in a relaxed cap, the
unmet-intent values, `preferences`, user or wallet identifiers inside payloads,
error text. A code-shaped field that is not a plain lowercase token (for
example a sentence in `reason`) is dropped and listed as "left out because it
was not a plain code".

To make coverage and pick position visible at all, the analytics bridge now
records `trackCount`, `pickIndex`, `pickCount`, `curatedBy`, `latencyMs`, a
sanitized `coverage` (filter keys and counts only) and `runtimeFallback` for
`agent.decision_made` (see the
[taxonomy](../architecture/analytics_event_taxonomy_v1.md)). It does **not**
record `reasoning` or `coverageSummary`. Since #2337 the bridge stores only the
keys of `unmetIntent` (never the values) and no longer records `trackTitle` on
`agent.mix_planned` and `agent.negotiated`; the view reads both the new key list
and the older object form. Events recorded before this change have
no coverage or pick position; the view shows what they have.

## Surfaces

- **`/admin/agent-sessions`** (admins): a session id field and **Show events**;
  the id is validated before navigating. Sidebar link **DJ Session Events**
  (admins only); the top bar titles the page "AI DJ Session Events".
- **`/admin/agent-sessions/[sessionId]`** (admins): session facts (id, owner link
  to `/admin/users/[id]`, started, ended, event count), the audit and retention
  notes, and an events table (time, event, identifiers, decision and coverage)
  that becomes cards on a phone. States: loading, `403` ("Admins only"), `404`
  ("Session not found"), `400` ("This is not a session id"), error with retry,
  capped list, and an empty list.
- `/help` article `admin-users`, section "What the AI DJ decided in a session
  (admins)".

## Verification

- Backend: `admin_agent_sessions.controller.http.spec.ts` (401, 403 for every
  non-admin role including operator, 200 for admin with the actor taken from the
  token), `admin_agent_sessions.integration.spec.ts` (ordering, whitelisting
  with hostile payloads, audit event, audit failure blocks the read, cap, 404 /
  400), `analytics_domain_event_bridge.spec.ts` (what the bridge keeps).
- Web: `SessionEventsView.test.tsx`, `SessionLookupView.test.tsx`, `pages.test.tsx`,
  `adminAgentSessions.test.ts`, `api.adminUsers.test.ts`.

## Not in this slice

- Finding a session id from a user's record or from Session History (today the
  admin needs the id, for example from a support report).
- Showing the events of a still-running session live.
- Backfilling coverage / pick position for events recorded before this change.
