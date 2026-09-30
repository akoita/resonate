# Vision Sprint 28: Refocus the AI DJ

**Status:** Planned 2026-09-30, starts 2026-10-01 (indicative end 2026-10-14).
**Milestone:** _to be linked when created_.
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
