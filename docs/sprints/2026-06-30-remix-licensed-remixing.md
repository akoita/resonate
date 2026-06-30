# Sprint Plan: Remix — Licensed Remixing End-to-End

**Dates:** Tue 2026-06-30 → Fri 2026-07-11 (10 working days)
**Team:** 1 engineer ([@akoita](https://github.com/akoita)) + AI agents
**Milestone:** [Resonate Remix: licensed remixing end-to-end](https://github.com/akoita/resonate/milestone/2)
**Tracker filter:** [`label:sprint:remix-licensing`](https://github.com/akoita/resonate/issues?q=is%3Aissue+label%3Asprint%3Aremix-licensing)

> **Sprint Goal:** A **non-owner** fan can buy a **Remix license** on a stem and
> generate an **audio-conditioned draft that actually uses those stems** — verified
> end-to-end on staging.

If that one sentence isn't true at demo, the sprint missed.

## Why these two — value & blocking

The Remix Studio MVP foundation (#892–#896), generation slices 1–3/5, layered
drafts, deterministic remix, and publish are **already shipped and live on
staging**. Picking by *most value / biggest blocker* (not convenience), exactly
two gaps matter — and both are **finishing work on an already-built backend**:

| Theme | Why | What's left |
|-------|-----|-------------|
| **A — Remix license purchasable** | *Biggest blocker.* On the stem page Remix/Commercial show **"Not listed"** → non-owners can't buy the remix right → the studio is owner-only. | **Frontend only.** Backend (pricing, listing intent, indexer, `StemPurchase.licenseType`, eligibility flip) is **done**. |
| **B — Cheaper audio-conditioned generation** | *Highest value.* Makes "remix the stems you licensed" real instead of prompt-only (#1182). | **Deploy + fix.** Scale-to-zero worker (`workers/stable-audio`) + backend provider **built**; licensing **GO** (pre-revenue). Remains: mono-output bug, scale-to-zero GPU deploy, enable, verify. |

## Sprint Backlog

| Priority | Item | Est | Notes |
|----------|------|-----|-------|
| **P0** | [#1304](https://github.com/akoita/resonate/issues/1304) list + buy Remix/Commercial tiers (frontend) | 8 | Artist tier selector in `ListStemModal` (reuse `LicenseTypeSelector`) + per-tier Buy buttons → `BuyModal`. Unlocks Remix **and** Commercial. |
| **P0** | [#1206](https://github.com/akoita/resonate/issues/1206) mono-output bug fix (`workers/stable-audio/main.py`) | 3 | Real-stem outputs came back mono in the spike; fix output-channel handling. Code-only, here. |
| **P1** | [#1206](https://github.com/akoita/resonate/issues/1206) scale-to-zero GPU deploy + enable on staging | 5 | `resonate-iac`: GPU Cloud Run `minScale=0`, `hf-token` secret, `REMIX_GENERATION_PROVIDER_KIND=audio-conditioned`, default-off → staging-on. |
| **P1** | [#1206](https://github.com/akoita/resonate/issues/1206) quality verify on staging | 3 | Run real stems through the deployed worker; confirm grounded (not mono), latency acceptable behind the async queue. |
| | **— P0 spine subtotal —** | **11** | **= the commit** |

**Committed (P0): ~11 pts** · **Stretch (P1): +8 pts** (the GPU deploy depends on the cloud-spend review landing).

## Day Map

| Days | Work |
|------|------|
| Jun 30 – Jul 2 | **#1304** artist tier selector + fan per-tier buy UI + component tests |
| Jul 2 – 3 | **#1304** E2E verify on staging (list Remix → buy as 2nd wallet → studio unlocks); User Guide + feature catalog |
| **Jul 3 — mid-sprint check** | **Gate:** licensed remixing works end-to-end on staging, or re-scope |
| Jul 3 – 4 | **#1206** mono-output bug fix + worker tests |
| Jul 4 – 8 | **#1206** scale-to-zero GPU deploy (resonate-iac) + enablement *(gated on cloud-spend review)* |
| Jul 8 – 11 | **#1206** quality verify on staging; fidelity follow-ups as time allows |

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| GPU deploy is a standing-cost decision; cloud spend under review | #1206 P1 slips | Scale-to-**zero** (pay-per-use), not warm; the worker is built; gate the deploy, not the code/mono-fix |
| Per-tier buy UI touches the on-chain buy path | Payment-flow breakage | Reuse the working Personal buy path (`BuyModal`); the only delta is which listing id / tier label |
| Mono-output bug may be GPU-only | Hard to verify without a GPU | Fix output-channel handling by inspection + a worker unit test; confirm on the staging deploy |

## Definition of Done (per repo CLAUDE.md)

- [ ] `npm run lint` green in `web/` (+ `backend/` if touched)
- [ ] Tests pass: `web` vitest (tier selector + buy state); worker test for the mono fix
- [ ] Feature catalog (`docs/features/remix_studio.md`) **and** in-app User Guide (`/help`) updated in the same branch
- [ ] `/finish-issue` security scan; PR reviewed & merged to `main` (never direct push)
- [ ] No silent partials — deferred items tracked on milestone #2 / the Remix epic #891

## Deferred (tracked, not this sprint)

- Export endpoint (`POST /remix/projects/:id/export`) + license-gated download.
- Remix contributor credentials ([#1114](https://github.com/akoita/resonate/issues/1114)/[#1115](https://github.com/akoita/resonate/issues/1115)/[#1116](https://github.com/akoita/resonate/issues/1116)).
- Section/inpaint editing research ([#1211](https://github.com/akoita/resonate/issues/1211)).
- Audio-conditioned fidelity beyond draft-quality.

---

_Source of truth for status is [milestone #2](https://github.com/akoita/resonate/milestone/2) and the [`sprint:remix-licensing`](https://github.com/akoita/resonate/issues?q=is%3Aissue+label%3Asprint%3Aremix-licensing) label; this doc is the point-in-time plan._
