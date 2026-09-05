# Sprint Plan: Vision Sprint 8 — Trustworthy Money + Discovery Foundations

**Dates:** 2026-07-11 → 2026-07-25 (indicative)
**Team:** 1 engineer ([@akoita](https://github.com/akoita)) + AI agents
**Milestone:** [Vision Sprint 8](https://github.com/akoita/resonate/milestone/10)
**Tracker filter:** [`label:sprint:vision-8`](https://github.com/akoita/resonate/issues?q=is%3Aissue+is%3Aopen+label%3Asprint%3Avision-8)
**Working mode:** flexible priority-set sprint — see [README.md](README.md)
**Revenue lines:** (1) Shows campaign fees — repair the money loop; (3)+(4)
discovery quality drives listening, collecting, and future Listener Pro value.

> **Sprint Goal:** the Shows money loop is provably green again (nightly smoke
> passing, pledges unblocked), and Resonate's discovery becomes intelligent:
> one ranking core behind `/recommendations` and the AI DJ, complete listening
> signals, true Trending/Top Artists, and a personalized multi-rail Home feed
> with explanations — plus the Home **Drops** shelf so the new collectible
> product is discoverable from the front page.

## Priorities

### P0 — Trustworthy money (line 1; days 1–2)

1. [#1399](https://github.com/akoita/resonate/issues/1399) — the nightly
   Shows lifecycle smoke is red (failed 2 of the last 3 nights). Diagnose and
   fix; the sprint does not proceed on feature work while the revenue-loop
   canary is red.
2. [#1391](https://github.com/akoita/resonate/issues/1391) — "Platform
   default" payment token stores `null` and blocks all pledges (live-UAT bug;
   prime suspect for the smoke failure). Fix the form default + chain-hydration
   adoption path.

### P1 — Discovery Intelligence core (epic [#1447](https://github.com/akoita/resonate/issues/1447), RFC merged)

3. [#1448](https://github.com/akoita/resonate/issues/1448) — WS-1: unified
   discovery ranking service behind `/recommendations` and the AI DJ.
4. [#1449](https://github.com/akoita/resonate/issues/1449) — WS-2: signal
   completeness (explicit skip, play/completion mirroring, home impressions).
5. [#1451](https://github.com/akoita/resonate/issues/1451) — WS-4: true
   Trending and Top Artists by category.
6. [#1454](https://github.com/akoita/resonate/issues/1454) — WS-7: Home
   discovery UX v2 — multi-rail personalized feed with explanations.

### P2 — Drops discoverability (line 3; small)

7. [#1479](https://github.com/akoita/resonate/issues/1479) — Home **Drops**
   shelf (umbrella naming per the 2026-07-11 decision; heuristic momentum
   ranking; `source: "home"` funnel attribution).

## Explicitly NOT in this sprint

- Drops monetization ([#1462](https://github.com/akoita/resonate/issues/1462))
  — waits on the operator pricing decision + a week of #489 funnel data; the
  demand cluster (#1476/#1477/#1478/#1481) is Sprint 9 candidate material,
  to be sequenced by the Drops strategy RFC.
- Discovery workstreams WS-3/5/6/8/9 — land after the core proves itself
  (WS-5/6 carry real model/compute cost; the #978 eval gate applies).
- Shows production go-live ([#1271](https://github.com/akoita/resonate/issues/1271))
  — remains operator-gated; this sprint only restores staging trust.

## Exit criteria

- Nightly lifecycle smoke green ≥3 consecutive nights; pledges work on a
  freshly created campaign with the default payment token.
- One ranking core serves `/recommendations` and the AI DJ (no divergent
  logic), with the new signals flowing and covered by integration tests.
- Home shows true Trending/Top Artists and the personalized multi-rail feed
  with explanation strings; the Drops shelf is live with funnel attribution.
- Feature catalog + User Guide updated for user-visible changes.

## Business-model conformance

P0 repairs revenue line (1) trust. P1 serves lines (3)+(4) (discovery quality
→ listening/collecting/Listener-Pro value) and is vision-core per the #1447
RFC. P2 is line (3) demand-side. No new fees/prices; red lines untouched.
