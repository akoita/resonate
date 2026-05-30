---
title: "Agent-Mediated Playback"
status: in-progress
owner: "@akoita"
source_context:
  - docs/features/playback_session_mvp.md
  - docs/features/agent-commerce-runtime.md
  - docs/features/agent_taste_intelligence.md
  - docs/strategy/agent_ui_ux_relevance.md
  - web/src/lib/playerContext.tsx
  - backend/src/modules/sessions/sessions.controller.ts
  - backend/src/modules/sessions/sessions.service.ts
---

# Agent-Mediated Playback

## Decision

Agent-mediated playback is a good product direction, but it should not be
implemented as an open public `play_music` tool that any external agent can call
against Resonate.

Adopt it as **owner-authorized playback intent and remote-control UX**:

```text
external agent -> playback intent -> owner policy/session -> active Resonate client -> audio playback
```

The agent can ask Resonate to find, queue, start, pause, skip, or explain music
on behalf of its owner only after the owner has granted a scoped capability and
only when an active Resonate client/device can accept the command.

## Why Not A Generic Public MCP Play Tool

Playback is not the same as catalog search, quote, or paid stem download.

Search, quote, and download are mostly request/response operations. Playback is
a live embodied action:

- it uses a specific device or browser tab;
- browsers can block programmatic audio without user interaction;
- the owner may be in a context where unexpected sound is harmful or annoying;
- playback creates listening analytics and taste signals;
- playback can affect artist payouts, rankings, recommendations, and demand
  signals;
- track availability, previews, stems, and encrypted audio have rights
  boundaries;
- external agents could spam plays, create fake engagement, or manipulate taste
  memory if the capability is too broad.

So the right interface is not "agent can play anything." The right interface is
"agent can propose or control playback inside an owner-approved session."

## Product Shape

Build this in three levels.

### Level 1: Playback Intents

The external agent sends an intent, not a raw play command:

```json
{
  "intent": "play",
  "query": "late night electronic with vocals",
  "constraints": {
    "maxTracks": 8,
    "explicit": false,
    "source": "resonate_catalog",
    "license": "stream_or_preview",
    "mood": "focused"
  },
  "ownerContext": {
    "devicePolicy": "active_resonate_client_required",
    "confirmation": "ask_if_sound_would_start"
  }
}
```

Resonate resolves this into a queue candidate, policy result, and optional
client command.

### Level 2: Owner-Scoped Playback Session

The owner grants a scoped capability such as:

- allowed action: `playback.intent`, `playback.queue`, `playback.pause`,
  `playback.skip`;
- allowed source: catalog, saved library, purchased stems, previews;
- device scope: current browser session, named device, or any active device;
- autonomy: propose-only, queue-with-confirmation, or remote-control while
  active;
- limits: time window, max queue length, explicit-content setting, volume cap;
- analytics policy: whether agent-triggered playback may train taste memory.

This should be separate from payment capabilities. Buying/licensing and playing
should not share one broad permission.

### Level 3: Active Client Execution

The active Resonate client performs the actual audio action through the existing
player layer. The backend should not pretend that server-side playback happened
when no device accepted the command.

The client command result should be explicit:

| Status | Meaning |
| --- | --- |
| `queued` | Track or queue was added, but not started. |
| `playing` | Active client accepted and started playback. |
| `confirmation_required` | Owner must approve before sound starts. |
| `no_active_device` | No eligible Resonate client is connected. |
| `blocked_by_policy` | Owner policy rejected the intent. |
| `unavailable` | Track/stem cannot be played under current rights/source rules. |

## AX/DX Contract

Agent-facing playback UX should follow this loop:

```text
discover devices -> resolve playable music -> submit intent -> receive policy result
-> command active client -> observe status -> explain outcome
```

Recommended tools or API surfaces:

| Surface | Purpose |
| --- | --- |
| `playback.capabilities` | Return whether owner-scoped playback is available, which devices are active, and what actions are permitted. |
| `playback.resolve` | Turn natural-language or structured intent into playable track/queue candidates without starting audio. |
| `playback.queue` | Add tracks to the owner's active queue under policy. |
| `playback.play` | Start playback only when policy and device state allow it. |
| `playback.control` | Pause, resume, skip, seek, or stop an existing owner session. |
| `playback.status` | Return current track, queue position, state, and last command result, with privacy redaction. |

These should be authenticated owner-scoped surfaces, not accountless public MCP
tools. If exposed through MCP later, they should require an owner-authorized MCP
session or signed capability token.

## What To Avoid

- Do not let accountless external agents trigger audio playback.
- Do not count agent-triggered plays as ordinary listener engagement without an
  explicit analytics marker.
- Do not let playback tools silently buy, license, or download stems.
- Do not expose private library, private taste, wallet, or ownership state to an
  external agent unless the owner granted that scope.
- Do not claim playback succeeded unless an active client confirms it.
- Do not train taste memory from agent-driven playback unless policy allows it.

## Positive And Negative Impact

| Actor | Positive impact | Negative risk | Mitigation |
| --- | --- | --- | --- |
| Listener | Can ask their preferred assistant to play, queue, pause, or explore Resonate music without manual app navigation. | Unexpected audio, polluted taste memory, privacy leakage, annoying remote control. | Active-device requirement, confirmation modes, visible policy, analytics marker, easy revoke. |
| Artist | More discovery and legitimate listening opportunities through assistants and creator workflows. | Fake engagement or low-intent plays could distort demand signals and payouts. | Mark agent-originated playback, apply fraud/rate limits, separate high-value demand metrics from raw plays. |
| Partners | Wallet agents, creator tools, smart speakers, and music assistants can integrate Resonate playback. | Integration support burden and inconsistent device behavior. | Versioned API, conformance tests, example clients, explicit device-state errors. |
| Operator | New distribution surface and richer observability of agent-driven listening. | Abuse, autoplay complaints, support tickets, and royalty/accounting ambiguity. | Permission model, observability, rate limits, policy audit trail, payout taxonomy. |

## Implementation Roadmap

| Phase | Outcome |
| --- | --- |
| P1 Playback Policy Model | Define owner-scoped playback capabilities, source scopes, autonomy levels, analytics markers, and revocation. |
| P2 Playable Resolver | Add a backend resolver that returns playable queue candidates from catalog/library constraints without starting audio. |
| P3 Active Client Bridge | Add WebSocket or polling delivery from backend command to active Resonate client; client confirms queued/playing/blocked. |
| P4 Agent-Facing Contract | Expose authenticated playback capabilities, resolve, queue, play, control, and status contracts. |
| P5 External MCP/OAuth Profile | If needed, expose the same contract through an owner-authorized MCP profile or OAuth-like signed capability flow. |
| P6 Abuse And Accounting | Add analytics markers, rate limits, fraud checks, payout classification, and operator dashboards for agent-originated playback. |

## First Implementation Slice

Start smaller than "agents can play music":

1. Add `agent_originated` and `initiator` fields to playback analytics events.
2. Define a playback capability model and policy document.
3. Add a `playback.resolve` API that converts intent into queue candidates.
4. Add a first-party in-app "remote queue request" flow that requires user
   confirmation before sound starts.
5. Only then allow an external owner-authorized agent to queue or start
   playback on an active client.

## Product Rule

Agent-mediated playback should feel like the owner gave a trusted assistant a
remote control, not like Resonate gave every external agent a loudspeaker.

## Implementation Notes

Issue [#1007](https://github.com/akoita/resonate/issues/1007) now has a first
owner-scoped backend contract:

- `GET /sessions/playback/capabilities`
- `POST /sessions/playback/resolve`
- `POST /sessions/playback/queue`
- `POST /sessions/playback/play`
- `POST /sessions/playback/control`
- `POST /sessions/playback/commands/:commandId/confirm`
- `GET /sessions/playback/status`

This slice intentionally keeps the active-device bridge conservative. Resolve
can return sanitized catalog candidates without starting sound, while queue,
play, and control require an active first-party client. Sound-starting commands
default to `confirmation_required`, and `playing` is accepted only after client
confirmation.
