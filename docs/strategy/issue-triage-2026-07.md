---
title: "Open-Issue Triage vs Business Model v2 — July 2026"
status: done
owner: "@akoita"
created: "2026-07-04"
related:
  - docs/strategy/business-model-review-2026-07.md
  - docs/strategy/business-model-phase0-decisions.md
---

# Open-Issue Triage vs the Updated Vision (2026-07-04)

All 90 issues open on 2026-07-04 were reviewed against the
[business-model review](business-model-review-2026-07.md) and the Phase-0
decisions (ADR-BM-1…6). Verdicts:

- **CORE** — directly serves an active revenue line or its prerequisite; keep,
  priority confirmed or raised.
- **KEEP** — conformant or vision-neutral (infra/quality); keep as prioritized.
- **UPDATED** — kept open, alignment comment posted on the issue.
- **CLOSED** — closed on GitHub with rationale (duplicate, red-line violation,
  or superseded).

Phase references = review §4 (P1 Shows → P2 Artist Pro/marketplace →
P3 Listener Pro → P4 rights infra/B2B).

## Actions taken on GitHub (2026-07-04)

| Issue | Action | Reason |
| --- | --- | --- |
| #1223 | **CLOSED** (duplicate) | Superseded by #1224 (broader campaign set, In Progress). |
| #272 | **CLOSED** (duplicate) | Duplicate of #280 (Remix Lineage Visualization). |
| #273 | **CLOSED** (duplicate) | Duplicate of #281 (Artist Earnings Dashboard). |
| #423 | **CLOSED** (red line) | DeFi yield on custody stakes violates ADR-BM-4 (no yield products on custody funds; Howey/securities + custody risk; see web3 postmortems, review §2.3). |
| #332 | **CLOSED** (superseded) | Lyria generation shipped; remix leg now tracked by #891/#1311/#1182; remaining slices live on as #348/#349. |
| #323 | **CLOSED** (not planned) | Autonomous AI-DJ real-time remixing overlaps #348 + Remix Studio, precedes any funding revenue line, and bypasses remix-license eligibility doctrine. Reopen post-P4 only as a licensed, credit-billed design. |
| #1271 | **UPDATED** | ADR-BM-1: campaign fee param must land in `ShowCampaignEscrow` **before** prod deploy; added to go-live gate expectations. |
| #891 | **UPDATED** | ADR-BM-3: gate GPU generation behind prepaid credits from day one; SA3/Gemma license (#1193) blocks billing. |
| #490 | **UPDATED** | Punchline Drops = marketplace line #3 + rap wedge; utility collectibles only, never income-bearing (ADR-BM-4); activate with ADR-BM-2 fee alignment. |
| #1004 | **UPDATED** | Roadmap issue now references the revenue-activation sequencing; #281 rises to Phase 2; #306/#307 defer to Phase 4–5. |
| #444 | **UPDATED** | Confirmed conformant: voluntary trusted-source fast path (never required); wire to existing `trusted_source_account` class (ADR-BM-5). |
| #324 | **UPDATED** | Bulk ingestion must be trust-tier gated (AI-flood attack surface); sequence Phase 4 with #444. |
| #309 | **UPDATED** | Stale "P1 — Next Sprint" → Phase 4 (needs LicenseRegistry/AncestryTracker + real GMV); ADR-BM-4 compliance note. |
| #1164 | **UPDATED** | Now load-bearing for ADR-BM-5 (payout gating via verification, DDEX AI labeling, distinct AI monetization policy). |

## Full verdict table

### Revenue line 1 — Shows (Phase 1)

| Issue | Verdict | Note |
| --- | --- | --- |
| #1271 Shows production-readiness + gated go-live | **CORE / UPDATED** | P0. Fee param (ADR-BM-1) added to gate expectations. |
| #1224 Media-rich sample show campaigns | **CORE** | In Progress; Phase-1 wedge content. |
| #1300 Contract upgradeability & recovery | **CORE** | Custody prerequisite for fee-bearing contracts. |
| #915 GCP account/project migration | KEEP | Infra epic; coordinate before prod go-live. |

### Revenue lines 2–3 — Artist Pro, generation credits, marketplace (Phase 2)

| Issue | Verdict | Note |
| --- | --- | --- |
| #891 Remix Studio MVP | **CORE / UPDATED** | P0. Credits gating per ADR-BM-3. |
| #1311 Remix Studio full epic | **CORE** | Line #2 depth. |
| #1182 / #1193 / #1206 / #1211 remix generation slices | **CORE** | #1193 (SA3/Gemma license) is a billing dependency of ADR-BM-3; #1206 gates on cost/latency (COGS for credits). |
| #1121 Artist action cockpit | **CORE** | In Progress; Artist Pro value driver. |
| #281 Artist Earnings Dashboard | **CORE** | Priority ↑ to Phase 2 — surface for the north-star metric (median take-home per artist). |
| #490 + #479–#489 Punchline Drops (12 issues) | **CORE / UPDATED (epic)** | Marketplace line #3 + rap wedge; utility-only framing (ADR-BM-4). |
| #285 Edition strategy configuration | KEEP | Marketplace depth; Sound.xyz lessons already internalized in body. |
| #284 Manual listing cancellation | KEEP | Marketplace hygiene, Phase 2. |
| #283 Quick remix from stem player | KEEP | Listen→create loop; must route through Remix Studio eligibility, not direct mint. |
| #280 Remix lineage visualization | KEEP | Differentiator storytelling; pairs with #309 in Phase 4 for royalty flows. |
| #355 Reduce passkey prompts | KEEP | Checkout friction is a direct revenue blocker for Phase 2. |
| #354 Smart account recovery | KEEP | Custody UX. |
| #350 Runware.ai exploration | KEEP | COGS reduction → better ADR-BM-3 credit margins. |
| #1326 Semantic catalog & stem search | KEEP | Credit-funded; discovery → license conversion. |
| #1325 "Ask Resonate" help assistant spike | KEEP | Credit-funded, cheap, self-standing. |
| #1101 SEO metadata | KEEP | Storefront discovery; cheap; Phases 1–2. |
| #838 i18n foundation | KEEP | Priority note: **francophone-rap wedge makes French localization a wedge enabler**, not a nice-to-have. |
| #248 Enhanced upload auto-metadata | KEEP | P3 backlog. |

### Revenue line 4 — Listener Pro & community density (Phase 3)

| Issue | Verdict | Note |
| --- | --- | --- |
| #996 Listener Community Network epic | **CORE** | Community density is the Phase-3 launch gate. |
| #977 AI DJ taste intelligence epic | KEEP | In Progress (background tick per roadmap); Listener Pro differentiator. |
| #1237 Ubiquitous playing session super-epic | KEEP | Deprioritize to Phase 3+; heavy, listener-experience. |
| #1106–#1108 supporter/collector credentials | KEEP | Superfan utility (M2 holder benefits). |
| #1110–#1112 show attendance credentials | KEEP | Post-Shows-launch utility loop. |
| #1114–#1116 remix contributor credentials | KEEP | Phase 4 (after License NFTs). |
| #251 Listening analytics & habit tracking | KEEP | P3 backlog. |

### Revenue line 5 & rights infrastructure (Phase 4)

| Issue | Verdict | Note |
| --- | --- | --- |
| #309 Recursive remix royalties | **CORE / UPDATED** | Re-sequenced P1→Phase 4; ADR-BM-4 compliance note. |
| #315 Exclusive licensing & legal covenants | KEEP | Licensing roadmap Phase 4. |
| #349 On-chain generation provenance | KEEP | Supports ADR-BM-5 labeling; Phase 4. |
| #324 Bulk release upload SDK | **UPDATED** | Trust-tier gating required; Phase 4 with #444. |
| #444 Distributor role | **UPDATED** | Confirmed conformant (voluntary trusted-source path). |
| #306 LangGraph multi-agent | KEEP | Defer to Phase 4–5. |
| #307 Agent personality templating | KEEP | P3 backlog; cosmetic; fine to leave parked. |
| #348 Lyria RealTime hybrid mixer | KEEP | Deprioritized (GPU cost precedes revenue); now standalone after #332 closure. |

### Trust, integrity & content protection (cross-phase, supports ADR-BM-5)

| Issue | Verdict | Note |
| --- | --- | --- |
| #1164 AI Music Integrity epic | **CORE / UPDATED** | Load-bearing for ADR-BM-5. |
| #404 Content Protection epic | **CORE** | Platform pillar; unchanged. |
| #407 CP Phase 3 (curation + disputes) | KEEP | Partially shipped; product readiness remains. |
| #408 CP Phase 4 (external fingerprint DBs + AI similarity) | **CORE** | Priority note ↑: first-line defense against the AI flood (rights-verification RFC makes fingerprinting mandatory). |
| #409 CP Phase 5 (decentralized governance + DMCA) | KEEP | P3; keep jury as escalation-only per rights-verification RFC. |
| #434 / #435 CP sprint issues (E2E/audit; anti-abuse) | KEEP | Pre-prod gates and fraud hardening. |
| #465 / #466 / #468 / #469 Dispute Center workflows | KEEP | Trust ladder Layer 6; sequence after Phase 1–2 revenue. |
| #477 Verification badges copy audit | **CORE** | Honesty doctrine; direct ADR-BM-5 support. |
| #347 SynthID verification on upload | KEEP | ADR-BM-5 detection layer. |
| #942 Content-protection contract refactor | KEEP | P2 contracts hygiene. |
| #415 / #416 OpenZeppelin & Pashov auditor skills | KEEP | Security tooling for custody gates. |

### Platform, data & quality (vision-neutral)

| Issue | Verdict | Note |
| --- | --- | --- |
| #881 BigQuery warehouse epic | KEEP | Feeds north-star metric reporting. |
| #1062 Batch analytics mode | KEEP | Cost discipline (margin doctrine). |
| #932 Staging analytics verification | KEEP | Ops. |
| #1171 Google Data Agent Kit spike | KEEP | Low. |
| #1004 Next-gen platform roadmap | **UPDATED** | Now references revenue sequencing. |
| #428 In-app User Guide | KEEP | In Progress. |
| #837 Accessibility baseline | KEEP | Quality. |
| #380 Lighthouse IPFS hardening | KEEP | Infra correctness. |
| #413 Prisma v7 migration | KEEP | Chore. |
| #314 Platform admin dashboard | KEEP | P2 ops. |
| #264 Decentralized encryption (Lit/Threshold) | KEEP | P3 backlog; only revisit if off-platform export DRM (Remix E3) demands it — "blockchain quiet" doctrine says don't add trustless complexity without a product driver. |

## Tally

- 90 open issues reviewed → **84 remain open** (6 closed).
- 8 issues received alignment comments; 3 priority changes recorded here
  (#281 ↑ Phase 2, #309 → Phase 4, #408 ↑ first-line defense).
- No issue needed reopening or migration; no orphaned child issues were left
  by the #332 closure (#348/#349 are self-contained).

## Vision labels (applied 2026-07-04)

Every open triaged issue now carries a GitHub label matching its verdict:

- **`vision:core`** (29 issues) — directly serves an active revenue line.
- **`vision:keep`** (55 issues) — conformant or vision-neutral.
- #309 relabeled `P1 — Next Sprint` → `P3 — Backlog` per its Phase-4
  re-sequencing.

New issues must be labeled on creation — see the "💰 Business Model
Conformance" section in `CLAUDE.md` and the conformance steps in
`.agents/workflows/start-issue.md` / `finish-issue.md`. An issue that fits
neither label should be challenged before work starts.
