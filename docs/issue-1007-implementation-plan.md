# Issue #1007 Implementation Plan: Agent-Mediated Playback Intents

## Goal

Implement owner-authorized playback intents so trusted external agents can
resolve, queue, and request playback through an active Resonate client without
creating surprise audio, private data leakage, fake engagement, or hidden
payment/licensing side effects.

The product contract remains:

```text
external agent -> playback intent -> owner policy/session -> active Resonate client -> audio playback
```

## Current Baseline

- `docs/strategy/agent_mediated_playback.md` defines the policy direction and
  target command outcomes.
- `#1006` established the public external-agent contract for catalog, quote,
  x402, receipts, and stable errors.
- `#1009` added listener taste-memory controls, including the setting that
  determines whether agent-originated playback can train listener taste memory.
- `backend/src/modules/sessions/sessions.controller.ts` currently exposes
  authenticated session start/stop/play, AI next-pick, and playlist endpoints.
- `backend/src/modules/sessions/sessions.service.ts` can resolve AI next picks,
  but it does not yet model owner playback capabilities, active devices,
  command confirmation, explicit command status, or agent-originated analytics.
- `web/src/lib/playerContext.tsx` owns real browser playback and analytics,
  which is the right place for final audio execution.

## Implementation Slices

### Slice 1: Contract And Policy Model

Add typed backend playback-intent concepts without introducing a public
accountless play tool.

- Define playback capability scopes:
  - `playback.intent`
  - `playback.resolve`
  - `playback.queue`
  - `playback.play`
  - `playback.control`
  - `playback.status`
- Define outcomes:
  - `queued`
  - `playing`
  - `confirmation_required`
  - `no_active_device`
  - `blocked_by_policy`
  - `unavailable`
- Define confirmation modes:
  - `propose_only`
  - `queue_with_confirmation`
  - `remote_control_when_active`
- Keep playback scopes separate from payment, licensing, download, and stem
  decrypt permissions.

### Slice 2: Authenticated Playback Resolve API

Add `playback.resolve` as the first safe operational endpoint. It should turn a
natural-language or structured intent into playable candidates without starting
audio.

Expected backend API:

- `POST /sessions/playback/resolve`
- Authenticated with the existing JWT guard.
- Accepts query, constraints, source preferences, and optional session context.
- Returns sanitized playable candidates, reasons, policy result, and next
  allowed command.
- Redacts private library, wallet, ownership, and taste data unless a future
  scoped policy explicitly allows it.

This can reuse the existing agent runtime/catalog recommendation path where it
fits, but the response must be playback-intent oriented and must not create a
license, payment, download, or audio-start side effect.

### Slice 3: Owner Policy And Active Device Stub

Add the first owner policy evaluator and active-device bridge boundary.

- Default policy should be conservative:
  - resolve is allowed for authenticated owner sessions;
  - queue/play/control require an active device;
  - sound-starting actions require confirmation unless policy says otherwise;
  - no payment/licensing actions are reachable from playback intent endpoints.
- Add a backend command-status shape even if the first slice uses an in-memory
  device registry or explicit `no_active_device` result.
- Do not claim `playing` unless the client confirms it.

### Slice 4: Queue/Play/Status Contract

Add authenticated endpoints for queue/play/status with explicit outcomes.

- `POST /sessions/playback/queue`
- `POST /sessions/playback/play`
- `POST /sessions/playback/control`
- `GET /sessions/playback/status`

The first implementation can return `confirmation_required` or
`no_active_device` for sound-starting actions until the web client bridge lands,
but the API contract and tests should already protect the unsafe cases.

### Slice 5: Client Bridge And Confirmation UX

Connect the web player to pending owner-authorized playback commands.

- The active client polls or subscribes for pending playback commands.
- The user sees a confirmation prompt before sound starts when required.
- Accepted queue commands update the existing player queue.
- Accepted play commands call the existing player layer and report client
  confirmation back to the backend.
- Declined commands report `blocked_by_policy` or `confirmation_required`
  resolution rather than pretending playback happened.

### Slice 6: Analytics And Taste-Memory Markers

Mark agent-originated playback distinctly end to end.

- Extend playback analytics input with:
  - `initiator`
  - `agentOriginated`
  - optional `agentSessionId` or command id
- Ensure agent-triggered playback can be separated from ordinary listener plays
  for analytics, fraud, payout, and taste-memory policy.
- Respect the listener setting from `#1009` before agent-originated playback
  trains taste memory.

### Slice 7: Docs And Feature Catalog

Update durable docs alongside code:

- `docs/features/README.md`
- a dedicated feature page for agent-mediated playback intents
- `docs/architecture/external_agent_application_contract.md`
- `docs/strategy/agent_mediated_playback.md` status and implementation notes
- `docs/features/listener_taste_memory_controls.md` if analytics/taste behavior
  changes materially

## Out Of Scope For This Issue

- Accountless public MCP playback tools.
- Silent buy/license/download/decrypt behavior from playback commands.
- Smart-speaker production OAuth/device-code flow.
- Full multi-device arbitration beyond the first active-device bridge.
- Payout policy changes beyond analytics classification.

## Test Plan

Backend focused tests:

- playback resolve returns candidates without side effects;
- no-active-device outcome;
- confirmation-required outcome;
- blocked-by-policy outcome;
- queued outcome when policy and device bridge allow queueing;
- playing outcome only after client confirmation;
- revoked or expired capability outcome;
- private library, taste, wallet, and ownership redaction;
- playback analytics includes initiator/agent-originated metadata.

Frontend focused tests:

- pending playback command renders with confirmation;
- accepted queue command updates player queue;
- declined play command does not start audio;
- agent-originated playback analytics payload includes the required markers.

Local validation should stay targeted:

```bash
cd backend && npx jest --runInBand src/tests/sessions.controller.spec.ts src/tests/sessions.controller.http.spec.ts
cd backend && npx jest --runInBand src/tests/playback_intents.spec.ts
cd web && npx vitest run --config ./vitest.config.ts src/lib/api.test.ts
cd web && npm run lint
cd backend && npm run lint
npm --prefix web run build
git diff --check
```

Run broader integration suites in CI unless this branch changes Prisma schema,
contract settlement behavior, or production storage/runtime boundaries.

## Recommended First PR Shape

For a first implementation PR, prioritize:

1. typed backend policy/outcome model;
2. authenticated `playback.resolve`;
3. conservative queue/play/status endpoints that protect active-device and
   confirmation requirements;
4. analytics field support for agent-originated playback;
5. docs and tests proving unsafe cases are blocked.

Then follow with a second PR for the full active-client bridge and polished web
confirmation UX if the first slice becomes too large.
