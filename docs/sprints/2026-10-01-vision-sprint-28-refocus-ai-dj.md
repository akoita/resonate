# Vision Sprint 28: Refocus the AI DJ

**Status:** Planned 2026-09-30, starts 2026-10-01 (indicative end 2026-10-14).
**Milestone:** [30](https://github.com/akoita/resonate/milestone/30).
**Goal:** The AI DJ never spends or generates on its own, and Sonic Radar shows
what resonated with the listener, not what the agent bought.

Direction: [AI DJ Rethink and Taste Engine](../strategy/ai-dj-taste-engine-2026-09.md) ·
[ADR-TE-1…6](../strategy/taste-engine-decisions.md) ·
[RFC: Taste Engine](../rfc/taste-engine.md) ·
[milestone plan](../roadmap/2026-10-taste-engine-milestones.md) ·
epic [#1952](https://github.com/akoita/resonate/issues/1952).

## Approved scope and order

| Priority | Issue | Outcome |
| --- | --- | --- |
| P0 | [#1954](https://github.com/akoita/resonate/issues/1954) | No listener preset selects `buy` mode; `buy` mode behind an operator flag that defaults off |
| P0 | [#1955](https://github.com/akoita/resonate/issues/1955) | Sonic Radar becomes the discovery journal |
| P1 | [#1956](https://github.com/akoita/resonate/issues/1956) | The dormant generation paths are removed |
| P1 | [#1456](https://github.com/akoita/resonate/issues/1456) | The DJ runs on the shared ranking core |
| P1 | [#1957](https://github.com/akoita/resonate/issues/1957) | The six recommendation rules are enforced and published |
| P2 | [#1958](https://github.com/akoita/resonate/issues/1958) | ERC-8004 and curator-agent work marked frozen |

Order: #1954 first (it stops the unwanted purchases), then #1956 before #1456
so the unification cannot switch the generation paths on, then #1957 on the
shared core, then #1955, which reads the resonance signals. #1958 is docs-only
and can land at any point.

## Delivery status (2026-09-30)

| Issue | Status | Where |
| --- | --- | --- |
| #1954 | `implemented` | Merged in #1982; the listening-only setup wizard (no budget or auto-buy wallet step) lands with the sprint PR |
| #1958 | `implemented` | Freeze notes in every planning doc; identity mint/attest UI hidden while `ERC8004_ENABLED` is off |
| #1957 | `implemented` | `discovery-policy.ts` and the shared explanation vocabulary; `listed` boost removed; "How recommendations work" User Guide article |
| #1956 | `implemented` | Orchestrator, mixer, tool registry and ADK curation agent no longer generate; sparse selections return a `shortfall` and record the unmet intent |
| #1955 | `implemented` | `GET /agents/discoveries` and the Sonic Radar journal; the "follow" next action waits on an artist-follow feature, which does not exist yet |
| #1456 | `partial` | Home, the deterministic DJ and the LLM runtime share one ranking core, one taste profile and the policy stage. Remaining: Home's other shelves (new from artists you play, trending, fresh drops in `home-feed.service.ts`) do not pass the policy stage yet; LLM picks get rules 1, 2, 4 and 5 but no exploration share; `AgentWorkerModule` cannot resolve `DiscoveryRankingService`, so the standalone worker skips the LLM policy step (fail-open) |

The staging exit checks (no purchase or generation without a person, Sonic
Radar lists only listened tracks) are verified after deployment.

## Exit criteria

- No agent session on staging produces a purchase or a generation job unless a
  person started it; a test covers both paths.
- Sonic Radar on staging lists only listened tracks, with categorical reasons
  and no price lines.
- Home and the DJ return the same explanations for the same track.
- A track's active stem listing no longer changes its listener ranking.
- User Guide pages for the AI DJ, Sonic Radar and recommendations, and the
  feature pages, are updated in the same PRs.

## Capacity and dependencies

Solo, about 10 working days: three S and two M items at P0 and P1, one of them
the #1456 refactor. ADR-TE-1…6 were accepted as written on 2026-09-30
([#1953](https://github.com/akoita/resonate/issues/1953)). A later change to a
decision re-scopes the sprint and is recorded here.

## Revenue line

Vision-neutral trust and quality (ADR-BM-6); removes latent unbilled GPU paths.
No fee, split, payout or ADR-BM-4 change.
