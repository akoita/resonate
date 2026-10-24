# Sprints — Working Mode

> Adopted 2026-07-04 (@akoita). Flexible priority-set sprints, not rigid
> unmodifiable iterations.

## How Resonate sprints work

A sprint is a **set of priorities that addresses one subject we judge to be
the next most important thing** — an important technical question, an
important user feature, an economic/business-model subject, or a mix. Sprints
are planning instruments, not contracts:

- **Theme first.** Each sprint has one theme and a one-sentence goal. If that
  sentence isn't true at the demo, the sprint missed.
- **Adjustable, explicitly.** Scope can change mid-sprint when reality
  demands it — but every re-scope is recorded in the sprint doc (what moved,
  why), never silent.
- **Priority tiers, not fixed backlogs.** P0 = the sprint fails without it;
  P1 = strongly expected; P2/stretch = only if P0s land early.
- **Exit criteria over dates.** Dates are indicative (usually ~10 working
  days); the sprint closes when exit criteria are met or the theme is
  re-judged.

## Artifacts per sprint

| Artifact | Convention |
| --- | --- |
| Sprint doc | `docs/sprints/<start-date>-<theme>.md` — goal, priorities, capacity, exit criteria; updated in place on re-scope and closed with an outcome banner |
| GitHub milestone | One per sprint; issues assigned |
| Sprint label | `sprint:<name>` on every sprint issue |

## Choosing the next sprint

At each sprint close, pick the next theme by judging what matters most now
across three lenses:

1. **Technical** — a hard question blocking future work (e.g., custody
   hardening, GPU inference shape).
2. **User** — a feature that changes what artists/listeners can do (e.g.,
   Remix Studio, Shows).
3. **Economic** — a Business Model v2 activation step (revenue-line
   sequencing per ADR-BM-6; see
   `docs/strategy/business-model-review-2026-07.md`).

Every sprint plan passes the **Business Model Conformance** check in
`CLAUDE.md` (red lines, revenue line/phase, canonical fees).

## Sprint index

Latest closed: [Vision Sprint 41 — Ready to charge, with honest money](2026-10-24-vision-sprint-41-ready-to-charge.md)
on 2026-10-24. #1421's pricing proposal awaits the owner's sign-off; deployment
halves resonate-iac#320–#322.
Current: [Vision Sprint 42 — Sell with confidence](2026-10-24-vision-sprint-42-sell-with-confidence.md).

| Sprint | Theme | Outcome |
| --- | --- | --- |
| [2026-06-29](2026-06-29-shows-mvp.md) | Shows MVP — campaign funding & trust escrow | ✅ Closed — over-delivered (12/12) |
| [2026-06-30](2026-06-30-remix-licensed-remixing.md) | Remix — licensed remixing end-to-end | ✅ Closed 2026-07-04 — 9/9, goal met on staging |
| [2026-07-06](2026-07-06-vision-sprint-1.md) | Vision Sprint 1 — remix finish + first revenue rails | ✅ Closed 2026-07-05, 12 days early — all P0s/P1s incl. ADR-BM-1…6 accepted; Phase 0 complete |
| [2026-07-06](2026-07-06-vision-sprint-2-first-real-money.md) | Vision Sprint 2 — first real money (Shows go-live + take-rate) | ✅ Closed 2026-07-06 — goal met: 6% fee loop proven end to end on staging (campaign 3: gross 5.00 / net 4.70 / fee 0.30 USDC, indexer-reconciled); 10%/15% take-rate live; carryovers → Sprint 3 |
| [2026-07-06](2026-07-06-vision-sprint-3-dependable-shows-ops.md) | Vision Sprint 3 — dependable shows ops (lifecycle smoke + operator usability) | ✅ Closed 2026-07-06 — goal met, all 5 items: automated lifecycle smoke green on staging (#1392), copy-paste-free activation (#1390), contract-term validation + correction path (#1356), operator guidance (#1363), honest fixtures (#1355) |
| [2026-07-07](2026-07-07-vision-sprint-4-portable-deployments.md) | Vision Sprint 4 — portable deployments (app data + user accounts survive GCP-project migration) | ✅ Closed 2026-07-07 — goal met, all 5 items: data-plane migration tool (iac#188), identity continuity + provable diagnostic (#1407), verification gate (#1408), durable content default-fix (iac#186, a live content-loss bug), complete runbook (iac#187) |
| [2026-07-07](2026-07-07-vision-sprint-5-generation-to-ownership.md) | Vision Sprint 5 — generation-to-ownership (Line 2: metered fair AI creation that feeds sellable ownership) | ✅ Closed — metered generation, provenance/rights gates, and creation-to-ownership foundation landed; live charging remained gated |
| [2026-07-10](2026-07-10-vision-sprint-6-production-billing.md) | Vision Sprint 6 — production billing | ✅ Closed — pricing/meter and Usage & Billing foundation landed; fiat charging remained gated |
| [2026-07-10](2026-07-10-vision-sprint-7-punchline-drops.md) | Vision Sprint 7 — Punchline Drops MVP | ✅ Closed — 12/12 Drops MVP slices completed |
| [2026-07-11](2026-07-11-vision-sprint-8-trustworthy-money-discovery.md) | Vision Sprint 8 — trustworthy money + discovery foundations | ✅ Closed — money-loop fixes and discovery-ranking foundations completed |
| [2026-07-12](2026-07-12-vision-sprint-9-custody-to-production.md) | Vision Sprint 9 — custody to production + first paid collects | ✅ Closed — custody/readiness and paid-collect foundations landed; Home performance carried forward |
| Vision Sprint 10 | Home performance follow-through | ✅ Closed as a carry-over planning milestone; #1491 moved into Sprint 11 |
| [2026-08-11](2026-08-11-vision-sprint-11-production-readiness.md) | Vision Sprint 11 — production readiness, not production | ✅ Closed — all nine focused slices landed; #1593 external release evidence and evergreen #1595 explicitly carried forward |
| [2026-08-11](2026-08-11-vision-sprint-12-production-controls.md) | Vision Sprint 12 — production controls and trust | ✅ Closed — all seven finite sprint outcomes landed; cache-TTL and first-software-release operations remain explicitly unmilestoned |
| [2026-08-26](2026-08-26-vision-sprint-13-restore-launch-path.md) | Vision Sprint 13 — restore and prove the launch path | ⏹ Stopped — four finite outcomes landed; #1663 and #1670 moved outside the milestone until `resonate-iac` Actions credits renew |
| [2026-08-28](2026-08-28-vision-sprint-14-retained-security-findings.md) | Vision Sprint 14 — close retained application security findings | ✅ Closed 2026-08-30 — all seven validated CodeQL alerts fixed on `main` |
| [2026-08-30](2026-08-30-vision-sprint-15-dependency-risk.md) | Vision Sprint 15 — triage and reduce dependency risk | ✅ Closed 2026-08-30 — reachability-aware baseline and safe dependency triage completed; deferred majors carried forward |
| [2026-08-30](2026-08-30-vision-sprint-16-deferred-dependency-majors.md) | Vision Sprint 16 — deferred dependency majors | ✅ Closed 2026-08-30 — Kernel v4 compatibility isolated while the legacy app/runtime boundary remained unchanged |
| [2026-08-30](2026-08-30-vision-sprint-17-platform-compatibility.md) | Vision Sprint 17 — platform compatibility and delivery confidence | ✅ Closed 2026-09-02 — merged into Milestone 20; Glamsterdam repricing (#1660), Next.js 16.3 (#1557), and Mergify queue (#1525) validated and landed |
| [2026-08-31](2026-08-31-vision-sprint-18-accessible-mobile-web.md) | Vision Sprint 18 — accessible, mobile-ready web experience | ✅ Closed 2026-09-02 — all 10 milestone outcomes complete (#1440, #837, #1101, #428, #1660, #1694, #1557, #1525, #1666, #1670); mobile, accessibility, metadata, User Guide, and staging confidence delivered |
| [2026-09-06](2026-09-06-vision-sprint-20-player-action-telemetry.md) | Vision Sprint 20 — trustworthy player action telemetry | ✅ Closed 2026-09-06 — authenticated action impressions and selections verified in staging |
| [2026-09-06](2026-09-06-vision-sprint-21-batch-analytics.md) | Vision Sprint 21 — trustworthy batch analytics | ✅ Closed 2026-09-10 — 2/2; batch/streaming parity and idempotency proved live, and the artist dashboard verified BigQuery-backed (#1062, #932) |
| [2026-09-11](2026-09-11-vision-sprint-22-dependable-releases.md) | Vision Sprint 22 — dependable releases and complete artist analytics | ✅ Closed 2026-09-11 — 6/6; release-plane validation and nightly coverage, build identity, server-side artist attribution, duplicate rows repaired, and a dead wallet action removed |
| [2026-09-16](2026-09-16-vision-sprint-23-data-rights.md) | Vision Sprint 23 — data rights the app can actually honor | ✅ Closed 2026-09-20 — 8/8; staging legal surface, consent, export and retryable warehouse erasure, durable generation refunds, and scheduled-automation reporting delivered |
| [2026-09-22](2026-09-22-vision-sprint-24-artist-identity-test-gates.md) | Vision Sprint 24 — stable artist identity, trustworthy test gates | ✅ Closed 2026-09-23 — 5/5; stable credited-artist IDs with ambiguity review and profile claims, complete mutation scoring, related-test CI selection, and an artwork-first public catalog |
| [2026-09-23](2026-09-23-vision-sprint-25-artist-management.md) | Vision Sprint 25 — artist management with reliable catalog status | ✅ Closed 2026-09-23 — 3/3; catalog status refresh, scoped artist management, and listener library removal |
| [2026-09-23](2026-09-23-vision-sprint-26-safer-artist-claims.md) | Vision Sprint 26 — safer artist profile claims | ✅ Closed 2026-09-23 — #1856 merged, release evidence recorded, milestone changelog published |
| [2026-09-23](2026-09-23-vision-sprint-27-artist-enrichment.md) | Vision Sprint 27 — trustworthy artist profile enrichment | ✅ Closed 2026-09-23 — #1763 merged, staging deployment verified, milestone changelog published |
| [2026-10-01](2026-10-01-vision-sprint-28-refocus-ai-dj.md) | Vision Sprint 28 — refocus the AI DJ (no autonomous spend or generation; Sonic Radar as a discovery journal) | ✅ Closed 2026-09-30 — all six items merged; [milestone-30 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-30-vision-sprint-28-refocus-ai-dj) records the application milestone, not a deployment |
| [2026-10-15](2026-10-15-vision-sprint-29-audio-aware-discovery.md) | Vision Sprint 29 — audio-aware discovery foundations (full-mix features, embeddings, measurement) | ✅ Closed 2026-10-02 — all five approved items merged; follow-ups remain separately tracked; [milestone-31 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-31-vision-sprint-29-audio-aware-discovery) records the application milestone, not a deployment |
| [2026-10-29](2026-10-29-vision-sprint-30-crate-digger.md) | Vision Sprint 30 — Crate Digger v1 (quoted, rights-clear crates for DJs) | ✅ Closed 2026-10-14 — all six items closed; the manual rekordbox/Serato import check carries over to #2121 and optional auto-buy to #2027; [milestone-32 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-32-vision-sprint-30-crate-digger) records the application milestone, not a deployment |
| [2026-11-19](2026-11-19-vision-sprint-31-scene-scout.md) | Vision Sprint 31 — Scene Scout v1 (qualified demand and next actions for artists) | ✅ Closed 2026-10-14 — all four items closed; the cross-artist access check and demand-retention drain carry over to resonate-iac#264; [milestone-33 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-33-vision-sprint-31-scene-scout) records the application milestone, not a deployment |
| [2026-10-03](2026-10-03-vision-sprint-32-purchased-stems.md) | Vision Sprint 32 — Purchased stems ready to remix | ✅ Closed 2026-10-15 — #2023, #2042 and #2139 merged and deployed; the owner-signed purchase walkthrough carries over to #2154; [milestone-34 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-34-vision-sprint-32-purchased-stems) |
| [2026-10-15](2026-10-15-vision-sprint-33-every-license-tier.md) | Vision Sprint 33 — Every license tier on sale (multi-tier listing, one-signature relist, live payout facts) | ✅ Closed 2026-10-15 — all six items closed (#1777 split into #2146–#2150); the owner-signed listing checks carry over to #2154; [milestone-35 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-35-vision-sprint-33-every-license-tier) |
| [2026-10-15](2026-10-15-vision-sprint-34-telling-people.md) | Vision Sprint 34 — Telling people what happens to them (notices, suspension, refund reminders, payout truth) | ✅ Closed 2026-10-16 — #2146, #2147, #2149, #2150 and #2167 merged and deployed, #2144 part 1 shipped (rest stays open), #2148 decided (email build is #2169); signed-in operator checks carry over to #2154; [milestone-36 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-36-vision-sprint-34-telling-people) |
| [2026-10-16](2026-10-16-vision-sprint-35-who-is-here.md) | Vision Sprint 35 — Seeing who's here, and reaching them (admin users directory, email notices) | ✅ Closed 2026-10-23 — all six issues closed (#2166, #2169, #2144 parts 2–3, #1890, #2180, #2177); real staging email delivery waits on resonate-iac#284; [milestone-37 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-37-vision-sprint-35-who-is-here) |
| [2026-10-22](2026-10-22-vision-sprint-36-dj-and-catalog-trust.md) | Vision Sprint 36 — A DJ you can understand, a catalog you can trust (AI DJ Phase 1, human-made attestation) | ✅ Closed 2026-10-23 — 10 of 11 issues closed; #2249 shipped slice 1 of 3; verified on staging at `13a88eea`; attestation run is resonate-iac#316; [milestone-38 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-38-vision-sprint-36-dj-and-catalog-trust) |
| [2026-10-23](2026-10-23-vision-sprint-37-dj-understands-meaning.md) | Vision Sprint 37 — A DJ that understands what you mean (AI DJ Phase 2: descriptors, sentence meaning, hybrid retrieval, Up next) | ✅ Closed 2026-10-23 — 9 of 10 issues closed (#2240–#2244, #2290, #2230, #2231, #2257); #2249 shipped slice 2 of 3; golden World and Rap cases in the top 20, mean recall@10/@20 82% / 90% (hybrid variant 87% / 95%); verified on staging at `e8214124`; descriptor backfill run on staging (27 tracks, 0 model calls); [milestone-39 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-39-vision-sprint-37-dj-understands-meaning) |
| [2026-10-24](2026-10-24-vision-sprint-38-dj-plays-what-you-asked.md) | Vision Sprint 38 — A DJ that plays what you asked for (request-first selection, honest analytics and pick notes, Right now start) | ✅ Closed 2026-10-24 — all 7 issues closed (#2317, #2316, #2299, #2245, #2249 slice 3, #2313, #2248 spike); request-first selection verified in the owner's Hip-Hop and World tests on staging at `105077ca` (every matching track, cap relaxed where needed, no padding); `hybrid_rrf_v1` kept as an experiment; [milestone-40 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-40-vision-sprint-38-dj-plays-what-you-asked) |
| [2026-10-24](2026-10-24-vision-sprint-39-dj-listens.md) | Vision Sprint 39 — A DJ that listens while you listen (in-session steering, trending source, Discovery/Tempo, artist tag corrections, My Mix reasons, operator events view) | ✅ Closed 2026-10-24 — all 6 issues closed (#2247, #2246, #2327, #2270, #2292, #2259); verified on staging at `3ef74447`; run under the owner's delegated authority; [milestone-41 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-41-vision-sprint-39-dj-listens) |
| [2026-10-24](2026-10-24-vision-sprint-40-honest-numbers.md) | Vision Sprint 40 — Honest numbers, toward Artist Pro (net received per sale, Usage & Billing foundation, artist external ids, analytics minimisation) | ✅ Closed 2026-10-24 — 3 of 4 issues closed (#2172, #2258, #2337); #1422 shipped its slice and stays open for buying credits (after #1421); verified on staging at `3ef74447`; [milestone-42 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-42-vision-sprint-40-honest-numbers) |
| [2026-10-24](2026-10-24-vision-sprint-41-ready-to-charge.md) | Vision Sprint 41 — Ready to charge, with honest money (pricing proposal, money-reporting gaps, admin step-up, Usage & Billing line, validation, indexer worker) | ✅ Closed 2026-10-24 — 5 of 6 issues closed (#2344, #2173, #1933, #2197, #1608) plus the indexer-route auth fix (#2355); #1421 pricing proposal delivered, owner sign-off pending; verified on staging at `35a2ea14`; [milestone-43 changelog-only release](https://github.com/akoita/resonate/releases/tag/milestone-43-vision-sprint-41-ready-to-charge) |
| [2026-10-24](2026-10-24-vision-sprint-42-sell-with-confidence.md) | Vision Sprint 42 — Sell with confidence (immediate-delivery consent, official lossless stems, indexer lease, admin hardening, wallet amounts, optional email prompts) | ◐ In progress — owner-approved 2026-10-24 (ADR-TE-7 accepted); milestone 44 |
