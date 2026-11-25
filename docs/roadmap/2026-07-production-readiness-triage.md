---
title: "Production Readiness Triage — the v1 Coherent Surface"
status: proposed
owner: "@akoita"
date: 2026-07-18
related:
  - "#1271 (completed Shows test/staging readiness gate)"
  - "#1583 (gated Shows production go-live)"
  - "docs/roadmap/2026-07-shows-to-prod.md"
  - "docs/features/README.md (feature catalog)"
  - "docs/strategy/business-model-phase0-decisions.md (ADR-BM-1…6)"
---

# Production Readiness Triage — the v1 Coherent Surface

**Revenue line / phase:** serves activation of revenue line 1 (Shows campaign
fees) per ADR-BM-6 sequencing; the triage itself is vision-neutral
(launch-quality/infra).

## Progress update — preview and production opening (2026-11-25)

The owner split the road to real users in two stages (Vision Sprint 59
"Clear for newcomers", "The road to the preview"):

- **Preview**: free and invitation-only, on the pre-production environment.
  No money moves: the money and AI-generation surfaces are switched off
  (#2658). This is the target of Vision Sprints 58–60.
- **Production opening**: planned and not scheduled (milestone 59: #2660,
  #1663, #1667). Real money waits for this stage.

Each ledger line is now marked **Preview** (must hold before invited people
come in) or **Opening** (waits for the production opening). A line is checked
only with evidence; "accept the gap" is a valid answer if written down.

### Lines that block the preview

| Line | State | Evidence or what remains |
| --- | --- | --- |
| Terms, privacy policy, refund promise, imprint | Done | Published in-app (#1769). A legal review before live charging is an opening line (#2649). |
| Data download and account deletion | Done | Export and erasure manifests cover every model; account closure and deletion (#1777 children). |
| Participation agreement on record | Done, text pending | #2666: acceptance per artist and per version. The agreement text is a marked placeholder until the operator publishes it. |
| Invitation-only sign-up, artist cap | Done | #2662. |
| Money and AI generation switched off | Done | #2658 switches: Shows pledging, paid collects, stem purchases, wallet, agent payments, AI generation. Covers ledger D "generation-credit billing", "Marketplace buy/list" and "audio-conditioned provider". |
| Listeners never receive the uploaded original | Done | #2661 streaming renditions. |
| Publishing without a deposit, with upload limits | Done | #2659. |
| Plain sign-in wording, short navigation | Done | #2663. |
| Report and takedown without an account | Done | #2664. |
| Email at sign-up and service emails | Done | #2665. Sending needs the email provider (deployment half). |
| Support channel and service status | Done | #2667. An on-call statement is an opening line. |
| Copy audit (no overclaiming) | Done | #477. |
| User Guide current | Done | #428, kept current per change (`web/AGENTS.md`). |
| Repository security settings | Done | #1539. |
| Composition details at upload | In review | #2669. |
| Preview measures | In review | #2670. |
| First-run, upload, playback and library QA | Open | Covered by the rehearsal with invited artists, #2672. |
| Community kept to a minimum slice; `/disputes` and `/curators` admin only; analytics labelled beta; routes without a feature page hidden; demo and seed leaks | Open | To be verified during the rehearsal, #2672. |
| Rate limits shared across instances | Open | Deployment half, tracked privately. |

### Lines that wait for the production opening

| Line | Why it waits |
| --- | --- |
| Payments and compliance review for USDC escrow; legal review of withdrawal, closure, renewal and dispute rules (#2649) | No money moves in the preview. |
| Shows with real pledges (#1583) | Pledging is switched off; the preview collects "I would come" interest (#2668). |
| Wallet funding and budget cap QA | The wallet surface is switched off. |
| Remix provider registration (#1342 follow-up) | AI generation is switched off. |
| External security review, or a written accept-the-gap decision | Before real money and open sign-up. |
| Supply-chain baseline (#1551), secret rotation posture | Opening hardening. |
| Start-up guards against development defaults (#2660) | Production environment. |
| Target configuration and cutover smoke (#1663) | Production environment. |
| First protected software release (#1667); release process otherwise done (#1593) | Production environment. |
| Backups and recovery, cost budgets and alerts, domain and email deliverability, on-call statement | Production environment. |
| Desktop app (unsigned, no auto-update) | Web only until then. |

## Progress update — Vision Sprint 11 close (2026-08-11)

Vision Sprint 11 closed its nine focused slices without making a production-go
claim. Home performance/mobile, Drops browse, x402 fee transparency, and Shows
reconciliation/indexer hygiene landed. PR
[#1610](https://github.com/akoita/resonate/pull/1610) also established the
software-release/versioning foundation.

The release-plane controls and a read-only Release Please preview are now
proven. PR [#1623](https://github.com/akoita/resonate/pull/1623) merged the
validator, and the [preview run](https://github.com/akoita/resonate/actions/runs/32797404994)
records the exact source and proposed version. The independent IaC release
contract is tracked in [resonate-iac#213](https://github.com/akoita/resonate-iac/issues/213).

Two boundaries intentionally remain open:

- [#1593](https://github.com/akoita/resonate/issues/1593) still requires
  `RELEASE_PLEASE_TOKEN`, `SOFTWARE_RELEASE_TOKEN`, and
  `RELEASE_AUTOMATION_ENABLED=true`; a separate non-bypass identity with
  retained unauthorized-actor negative tests; a generated Release Please PR; a
  Software Release `preview`; and one real evidence-linked software release;
- [#1595](https://github.com/akoita/resonate/issues/1595) remains the whole-app
  readiness denominator. Sprint closure does not waive its legal, privacy,
  security, feature-gating, support, or infrastructure blockers.

The distributed Shows indexer lease
[#1567](https://github.com/akoita/resonate/issues/1567) is complete. Background
indexers still keep staging API instances warm, so separating those schedulers
from the API runtime is tracked in
[#1608](https://github.com/akoita/resonate/issues/1608). The application half
(`BACKEND_RUNTIME_MODE`: `combined`, `api`, `worker`) is described in
[Backend runtime modes](../features/backend_runtime_modes.md); running the worker
as its own service is deployment work.

## Why this document exists

The #1271 engineering gate for Shows custody is complete: hardening, blocking
formal CI, the internal security review (all findings remediated), and the
staging money loop with reconciliation + mismatch alerting are proven
end-to-end. Production-only work now lives in #1583. But **Shows cannot be deployed alone**. Resonate is one Next.js
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
| Home + discovery rails | shipped S8 | The storefront for Shows *and* Drops. #1491 completed the measured Home performance program: cold LCP/CLS and image budgets pass, the unstyled flash is fixed, below-fold work is deferred, and responsive artwork plus prefetch reductions materially cut bytes and requests. Cache-coherent artwork versioning (#1604) and mixed-ingestion sibling-stream cleanup (#1605) remain independent hardening follow-ups. |
| Shows end-to-end | `partial` (staging-proven) | The flagship. The researched cohort campaign fixtures from #1224 are complete. The remaining production go-live package stays in #1583 (owner GO, prod escrow deploy, `contractCampaignId` wiring, prod indexer verification, production fixture gating, and controlled cohort). |
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
| Any remaining demo/seed surfaces | `CAMPAIGNS[]` fallback gating is a #1583 go-live item; sweep for other fixture leaks. |

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
| **Support & ops** | Partial | Custody runbooks, smoke, drill, alert email, and the #1506 operator `refund_due` reconciliation surface are complete. Missing: a support channel for real users and an incident/on-call statement. |
| **Abuse & moderation** | Partial | Rights verification routes uploads; community moderation tooling exists but is unstaffed — which is why community is gated above. Rate limiting / abuse posture needs a sweep. |
| **Security** | Strong, one gap | Internal review complete and remediated (1H/2M/4L). The checklist's "ideally one external review" is unmet — acknowledge explicitly in the go decision, or commission one. |
| **Infrastructure target** | Migrate first — accepted 2026-08-25 | [#1613](https://github.com/akoita/resonate/issues/1613) selects the intended production project, `resonate-493513`, before the first controlled cohort; see the [accepted comparison](../architecture/production-gcp-target-decision.md). This does not authorize migration or go-live. Backups/DR, secret rotation, cost budgets + alerts, domain/DNS/email deliverability, target verification, and the remaining #1595 gates still block production. |
| **Payments/compliance posture** | Designed | ADR-BM-4 red lines hold (no yield products, pre-funded listener payouts, artist ≥85%); ADR-BM-5 human-verification gate is live. Confirm no jurisdiction-specific obligation attaches to USDC escrow at cohort scale. |

## What this means: the real remaining backlog

1. **Quality:** #1491 Home perf and #1224 sample campaigns are complete;
   playback + wallet-funding + upload QA passes remain;
   `/help` refresh.
2. **Gating work:** implement the GATE/HIDE decisions above (nav pruning,
   role gates, flags, beta labels) — mostly small, but it *is* code work.
3. **Docs truth:** six draft feature pages + four uncatalogued routes.
4. **Cross-cutting:** legal pages, GDPR controls (or narrowed analytics),
   support channel, infra-target comparison, backup/cost sweep,
   and the remaining #1593 release credentials, negative-control tests, and
   publication evidence.
5. **Then** the #1583 gated go-live package itself (owner GO → production contract deploy → cohort).

Items 1–4 are the honest distance between "custody is proven in staging" and
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
