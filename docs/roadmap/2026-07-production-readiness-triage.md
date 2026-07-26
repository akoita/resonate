---
title: "Production Readiness Triage — the v1 Coherent Surface"
status: proposed
owner: "@akoita"
date: 2026-07-18
related:
  - "#1271 (Shows production-readiness + gated go-live)"
  - "docs/roadmap/2026-07-shows-to-prod.md"
  - "docs/features/README.md (feature catalog)"
  - "docs/strategy/business-model-phase0-decisions.md (ADR-BM-1…6)"
---

# Production Readiness Triage — the v1 Coherent Surface

**Revenue line / phase:** serves activation of revenue line 1 (Shows campaign
fees) per ADR-BM-6 sequencing; the triage itself is vision-neutral
(launch-quality/infra).

## Why this document exists

The #1271 engineering gate for Shows custody is green: hardening, blocking
formal CI, the internal security review (all findings remediated), and the
staging money loop with reconciliation + mismatch alerting are proven
end-to-end. But **Shows cannot be deployed alone**. Resonate is one Next.js
app, one NestJS backend, one database, one deployment: the day Shows takes
real money, every route in the app faces real users at whatever state it is
in. A fan trusting us with a pledge will also open Drops, discovery, the
marketplace, the library — and will judge the platform by its weakest visible
surface.

This matches the standing 2026-07-05 operator decision: the project stays in
dev/test/staging **until a stable and coherent version exists**. That is a
statement about the application, not about one feature. This document defines
what "stable and coherent" means concretely, so the go/no-go decision has a
real denominator instead of a Shows-only checklist.

The catalog documents **46 feature pages**; by declared status only ~9 are
`implemented`, versus ~12 `partial`, ~10 `in-progress`, and several pages
still marked `draft`. Launching does **not** mean finishing all of them. It
means making an explicit decision for each launch-visible surface:

| Decision | Meaning |
| --- | --- |
| **SHIP** | Included in v1 as-is; re-verify, no new work expected. |
| **POLISH** | Included in v1 and on the critical first-session path — must be excellent; targeted work required. |
| **GATE** | Kept behind a flag, role, allowlist, or explicit "beta" label for v1; enabled deliberately later. |
| **HIDE** | Removed from prod navigation/routes until finished; work continues in staging. |

## The launch surface (what a day-one user actually sees)

Sidebar today (17 destinations): Home, `/agent` (AI DJ), `/analytics/agent-quality`,
`/artist/analytics`, `/artist/catalog`, `/artist/upload`, `/community`,
`/create`, `/disputes`, `/help`, `/library` (+ playlists tab), `/marketplace`,
`/player`, `/settings`, `/shows`, `/sonic-radar`, `/wallet`. Additional routed
surfaces: `/catalog`, `/release/*`, `/stem/*`, `/moments/*`, `/playlist/*`,
`/remix/*`, `/curators`, `/import`, `/collection`, `/admin`.

**v1 north star:** a small real-user cohort can *listen, discover, support a
show with real money, and collect a moment* — flawlessly — while everything
else is deliberately shipped, gated, hidden, or honestly labeled.

## Feature triage

### The critical path — POLISH (must be excellent)

| Surface | Status today | Why it is critical / required work |
| --- | --- | --- |
| Onboarding + passkey auth/wallet | cross-cutting | First minutes of every cohort user; smart-account creation, session reset (#1199) exists. Full first-run QA pass needed. |
| Home + discovery rails | shipped S8 | The storefront for Shows *and* Drops. #1491 (perf: slow/unstyled Drops cards) is open and launch-blocking for quality. |
| Shows end-to-end | `partial` (staging-proven) | The flagship. Engineering proven; needs #1224 content (go-live cohort campaigns) + the production go-live section of #1271 (prod escrow deploy, `contractCampaignId` wiring, prod indexer verification, gate the seeded `CAMPAIGNS[]` fallback). |
| Player / playback sessions | page still `draft` | Core listening loop. The feature page must be brought to truth and the playback path QA'd; Player Action Layer (`in-progress`) ships in its current scope (Shows chip live). |
| Library (+ Moments tab, playlists) | shipped | Where ownership lands after collecting. Verify pass. |
| Wallet funding + budget cap | page still `draft` | Fans fund pledges through this. Needs a truth pass on the doc and a hard QA of funding UX, low-balance, and failure states. |
| Artist upload flow | page still `draft` | Real artists in the cohort need it; rights routing (`partial`) covers the core. Doc truth pass + upload QA. |
| In-app User Guide `/help` | `implemented` | Launch users self-serve here; refresh screenshots and Shows/Drops articles at go-time. |

### SHIP as-is (re-verify only)

Update Available Prompt · Graceful Session Reset · Obsidian Frequency design
system · Public Playlists · Stake Visibility Views · Artist Profile · Artist
Credit Picker · Payout Eligibility Gating (ADR-BM-5 fail-closed — required
for launch) · AI Music Generation (as capability; billing is gated below) ·
Catalog Indexing (core reads; page needs a truth pass) · Agent Commerce
Runtime (backend boundary) · Agent Taste Intelligence (invisible, fail-open)
· Staging smoke + reconciliation drill (ops tooling) · analytics backend
cluster (event ledger, pipeline observability, geo dimension — operator
surfaces, invisible to users).

### Punchline Drops — SHIP, with monitoring

`in-progress` by label but end-to-end complete (build → publish → free and
paid collects → inventory → unlocks → share; x402 rail at the 15% personal
take, `refund_due` operator reconciliation + alerting in place). It is the
second money loop and the demand engine for the storefront. Recommend
shipping with the same cohort, watching the #489 funnel and `refund_due`
alerts. Follow-ups (#1467 on-chain claims, #1470 auctions) stay deferred.

### GATE for v1 (explicit flag/label/allowlist; enable deliberately)

| Surface | Why gated | Gate mechanism |
| --- | --- | --- |
| Generation credits / `/create` billing | Meter is staging-scope; Stripe top-up deferred; SA3 commercial-license review (#1193) blocks charging money | Operator `POST /credits/grant` promo path only; no self-serve top-up UI |
| Marketplace (`/marketplace`) | `in-progress`; second real-money surface; ADR-BM-6 puts take-rate in a later phase | Keep browse; decide buy/list exposure at go-time (listing already payout-gated). Recommend cohort-visible but explicitly reviewed as its own go item |
| Remix Studio | Rights-gated and attribution shipped, but Stability operator registration is the outstanding non-code obligation (#1342) | Keep eligibility-gated CTAs; do not enable the audio-conditioned provider for real users until registration is done |
| Listener Community Network (`/community`) | `in-progress`; day-one moderation load is unstaffed; large privacy surface | Reduce to the minimum useful slice (e.g. Shows supporter rooms for cohort campaigns); hold cohorts/city scenes/holder benefits |
| Community curation `/disputes`, `/curators` | `partial`; public jury/curation flows are not launch-critical | Role-gate to admin/operator |
| Agent-mediated playback intents | `in-progress`; trusted-agent scope by design | Already restricted; keep allowlist |
| Artist analytics `/artist/analytics` | `partial` | Ship behind an honest "beta" label (artist-facing, low risk) |
| `/analytics/agent-quality` | Operator surface in the sidebar | Role-gate out of the public nav |
| Listener taste memory controls | `in-progress`, privacy-critical | If taste features ship in v1, the controls slice that governs them must ship too — scope to what v1 actually exposes |

### HIDE for v1 (remove from prod nav/routes until done)

| Surface | Why |
| --- | --- |
| Desktop app artifacts | Unsigned, no auto-update; do not advertise. Web-only launch. |
| `/sonic-radar` | Not in the feature catalog at all — undocumented surface. Audit; hide unless it earns a catalog page and a decision. |
| `/import`, `/collection` | Same: not catalogued; audit → hide or document. |
| Any remaining demo/seed surfaces | `CAMPAIGNS[]` fallback gating is already a #1271 go-live item; sweep for other fixture leaks. |

**Catalog hygiene (violations of the "no silent partial features" rule):**
`/sonic-radar`, `/import`, `/collection`, `/curators` exist as routes without
catalog entries; six feature pages (`playback_session_mvp`,
`wallet_funding_budget_cap`, `artist_upload_flow_mvp`, `catalog_indexing_mvp`,
`payment_splitter_integration`, plus review `community_curation_disputes`)
carry `draft`/`see page` status. Bring pages to truth as part of v1 prep —
two of them (playback, wallet funding) are on the critical money path.

## Cross-cutting production requirements (no feature page owns these)

| Area | State | Required before go |
| --- | --- | --- |
| **Legal** | Not in repo | Terms of Service, Privacy Policy, refund policy for escrow pledges (fee-free refunds are implemented — write the promise down), imprint/contact, cookie/consent posture. Real money without ToS is not launchable. |
| **Privacy / GDPR** | Partial | Analytics consent & retention policy exists as policy; the **user-facing controls and deletion propagation are explicitly follow-up work** — data export/delete must work (or analytics scope be narrowed) before real users. |
| **Support & ops** | Partial | Custody runbooks, smoke, drill, alert email proven. Missing: a support channel for real users, an incident/on-call statement, and the #1506 operator refund panel (runbook exists; panel open). |
| **Abuse & moderation** | Partial | Rights verification routes uploads; community moderation tooling exists but is unstaffed — which is why community is gated above. Rate limiting / abuse posture needs a sweep. |
| **Security** | Strong, one gap | Internal review complete and remediated (1H/2M/4L). The checklist's "ideally one external review" is unmet — acknowledge explicitly in the go decision, or commission one. |
| **Infrastructure target** | Undecided | The production environment question (#915: migrate-first vs current project) is deferred to the go decision **with a written comparison required**. Also: backups/DR posture, secret rotation, cost budgets + alerts, domain/DNS/email deliverability for real users. |
| **Payments/compliance posture** | Designed | ADR-BM-4 red lines hold (no yield products, pre-funded listener payouts, artist ≥85%); ADR-BM-5 human-verification gate is live. Confirm no jurisdiction-specific obligation attaches to USDC escrow at cohort scale. |

## What this means: the real remaining backlog

1. **Content:** #1224 sample campaigns (open, in progress).
2. **Quality:** #1491 Home perf; playback + wallet-funding + upload QA passes;
   `/help` refresh.
3. **Gating work:** implement the GATE/HIDE decisions above (nav pruning,
   role gates, flags, beta labels) — mostly small, but it *is* code work.
4. **Docs truth:** six draft feature pages + four uncatalogued routes.
5. **Cross-cutting:** legal pages, GDPR controls (or narrowed analytics),
   support channel, #1506 panel, infra-target comparison, backup/cost sweep.
6. **Then** the #1271 go-live section itself (prod contract deploy → cohort).

Items 1–5 are the honest distance between "custody is proven in staging" and
"a coherent v1 in production." None of them are custody engineering — the
gate did its job — but all of them face the first real user.

## Open decisions for the operator

- Marketplace exposure in v1: browse-only, cohort-full, or gated?
- Community minimum slice: supporter rooms only, or fully hidden?
- External security review: commission, or explicitly accept the internal-only
  pass in the go decision?
- Analytics scope for launch: implement user-facing consent/deletion controls,
  or narrow collection until they exist?
- v1 cohort definition (size, who, invite mechanics) — shapes several gates.

Once these are decided, this document should be revised from `proposed` to
`accepted` and the go/no-go package assembled: this triage + the infra-target
comparison + the cohort plan.
