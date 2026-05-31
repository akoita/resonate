---
title: "Agent-Mediated Playback Intents"
status: in-progress
owner: "@akoita"
issue: 1007
---

# Agent-Mediated Playback Intents

## Status

`in-progress`

The current implementation defines the owner-scoped backend contract and wires
the web player as the first active playback client. It does not expose
accountless public playback tools and does not let backend calls claim that
browser audio started before an active client confirms it.

## Who It Is For

- Listeners who want a trusted assistant to resolve, queue, or request music
  playback on their behalf.
- Agent and integration developers building owner-authorized music assistants.
- Backend and frontend developers wiring external intents into the Resonate
  player safely.
- Product, analytics, and fraud reviewers who need agent-triggered plays to be
  distinguishable from ordinary listener playback.

## Value

Playback is a live client action, not a generic catalog lookup. The feature
lets agents ask for playback while preserving listener consent, device state,
privacy, artist economics, and analytics integrity.

The contract follows:

```text
external agent -> playback intent -> owner policy/session -> active Resonate client -> audio playback
```

## Current Capabilities

- Authenticated owner-scoped playback capability discovery:
  - `GET /sessions/playback/capabilities`
- Optional first-party capability creation and revocation for scoped tests and
  future UI:
  - `POST /sessions/playback/capabilities`
  - `POST /sessions/playback/capabilities/:capabilityId/revoke`
- Active client registration boundary:
  - `POST /sessions/playback/device`
- Web player active-client bridge:
  - registers the browser player while the user is authenticated;
  - polls `GET /sessions/playback/status` for pending commands;
  - applies queue/control commands to the existing player queue;
  - shows a listener confirmation dialog before sound-starting play commands;
  - confirms `queued`, `playing`, `blocked_by_policy`, or `unavailable` back
    through `POST /sessions/playback/commands/:commandId/confirm`.
- Safe resolver that returns playable candidates without starting sound:
  - `POST /sessions/playback/resolve`
- Explicit command outcomes for queue, play, control, confirmation, and status:
  - `POST /sessions/playback/queue`
  - `POST /sessions/playback/play`
  - `POST /sessions/playback/control`
  - `POST /sessions/playback/commands/:commandId/confirm`
  - `GET /sessions/playback/status`

The current slice keeps command/device state in process memory. It is
appropriate for proving contracts, tests, and first-party bridge behavior, not
for durable multi-device production orchestration.

## Policy Rules

- Playback capabilities are separate from payment, licensing, x402 download,
  stem decrypt, and marketplace purchase permissions.
- Accountless external agents cannot start audio.
- Resolve can return sanitized catalog candidates without an active device.
- Queue/play/control require an active eligible Resonate client.
- Sound-starting actions default to confirmation-required.
- `playing` is reported only after client confirmation.
- Private library, wallet, ownership, and raw taste data are redacted unless a
  later scoped owner policy explicitly grants them.

## Analytics And Taste Memory

Playback analytics inputs now accept optional agent markers:

- `initiator`
- `agentOriginated`
- `agentSessionId`
- `playbackCommandId`

These fields let downstream analytics, fraud, payout, and taste-memory systems
separate external-agent playback from ordinary listener-initiated playback.
Taste-memory training remains governed by listener controls from
[Listener Taste Memory Controls](listener_taste_memory_controls.md).

## How To Verify

Backend:

```bash
cd backend && npx jest --runInBand src/tests/playback_intents.spec.ts src/tests/sessions.controller.spec.ts src/tests/sessions.controller.http.spec.ts
```

Frontend API helpers:

```bash
cd web && npx vitest run --config ./vitest.config.ts src/lib/api.test.ts src/components/player/PlaybackIntentBridge.test.tsx
```

## Follow-Up Work

- Replace in-memory backend command/device state with durable session storage
  or a production realtime transport when multi-instance deployment needs it.
- Add an owner-facing playback permissions UI for capability creation,
  revocation, expiry, and autonomy modes.
- Add durable capability/session persistence if external owner-authorized
  integrations need long-lived grants.
- Extend MCP/OAuth-style owner authorization only after the first-party active
  client bridge is proven.
