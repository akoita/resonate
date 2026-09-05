# Roadmap — Shows production-grade hardening (test), then Remix (2026-06-29 → 2026-07-27)

**Window:** 4 weeks (~2 sprints) · **Owner:** [@akoita](https://github.com/akoita) (solo + AI-assisted)
**Locked theme:** harden Resonate Shows to **production-grade quality/security — in the test environment** — then open the Remix Studio MVP.

> **No production deployment in this window.** We stay in the test environment.
> The actual production deploy + real-user launch is a separate, **gated**
> decision (see "Production go-live" below) — not scheduled work here.

> Rationale: Shows is the closest-to-PMF, real-money feature. Getting its custody
> to production-grade quality/security (verified in test) is the priority before
> opening a heavy new GPU-bound build (Remix). The custody-contract hardening is
> a shared prerequisite for both.

## Status snapshot (reconciled 2026-08-09)

- **Shows readiness gate:** complete in test/staging under
  [#1271](https://github.com/akoita/resonate/issues/1271); Shows remains **not
  in production for real users**.
- **Custody verification:** [#943](https://github.com/akoita/resonate/issues/943),
  [#944](https://github.com/akoita/resonate/issues/944), and
  [#1260](https://github.com/akoita/resonate/issues/1260) are closed. Halmos is
  a blocking PR gate; Certora and mutation remain scheduled/manual
  complements.
- **Current staging graph:** the Base Sepolia UUPS proxy deployed through
  [#1568](https://github.com/akoita/resonate/pull/1568) passed both refund and
  fee/release lifecycle smokes with backend indexer reconciliation.
- **Production:** separately tracked in
  [#1583](https://github.com/akoita/resonate/issues/1583) and blocked pending an
  explicit owner GO plus the application-wide launch package.

---

## Sprint 1 (wks 1–2, Jun 29 → Jul 10): Shows production-grade hardening & security (test env)

**Sprint goal:** Shows custody is production-grade — hardened, security-reviewed, and verified end-to-end **in the test environment** — so it's *ready to deploy when you choose*. **No production deployment in this sprint.**

| Priority | Workstream | Concrete items | Exit criteria |
|---|---|---|---|
| P0 | **Close custody hardening** (#943/#944) | Certora specs for `StemNFT` + `StemMarketplaceV2` (last critical contracts without one); deepen marketplace invariants; run **Gambit** mutation on the 4 high-value targets and kill survivors | #943/#944 closeable; mutation score recorded |
| P0 | **Halmos → blocking** (part of #1260) | Refactor formal `check_*` off `vm.expectRevert` + reverted-`setUp`; drop `continue-on-error` in `.github/workflows/formal.yml` | Halmos is a required check |
| P0 | **Security review** (the gate) | `/security-review` + a focused manual pass on `ShowCampaignEscrow` + `RevenueEscrow` + `ContentProtection`; ideally one external audit pass | No unresolved high/critical findings |
| P0 | **Verify the full loop in test** | On testnet: pledge → escrow → receipt → refund/release end-to-end; `ENABLE_SHOWS_ESCROW_INDEXER` reconciliation + `shows.campaign_reconciliation_mismatch` alerting; gate/flag the seeded `CAMPAIGNS[]` web fallback for prod builds | Full loop green on testnet; no reconciliation drift |

**Not in this window:** production deployment, address promotion, or real-user launch — those are gated (below).

## Sprint 2 (wks 3–4, Jul 13 → Jul 27): Remix Studio MVP kickoff (#891)

| Priority | Item |
|---|---|
| P0 | Land design slice [#1182](https://github.com/akoita/resonate/issues/1182) (stem-grounded generation — licensed stems shape the output) |
| P0 | Adopt-gate [#1193](https://github.com/akoita/resonate/issues/1193) (Stable Audio 3 GPU quality spike + Stability/Gemma license review) |
| P1 | Spike [#1206](https://github.com/akoita/resonate/issues/1206) — audio-conditioned generation provider + warm GPU inference service (**gate on cost/latency before building on it**) |
| P1 | Wire rights-gating (remix-tier purchase already unlocks Remix Studio via #1141) |
| P2 (bg) | AI DJ taste #977 / Artist cockpit #1121 tick; schedule Certora/Gambit workflows (#1260) |

---

## Production go-live (GATED — pending an explicit go-decision; NOT in this window)

Tracked in [#1583](https://github.com/akoita/resonate/issues/1583). Run **only** once you decide to take Shows to real users. The Sprint-1 prerequisites are green; that is readiness evidence, not launch authorization.

**Prerequisites (the gate):**
- [x] Custody hardening closed (#943/#944).
- [x] Halmos promoted to a blocking CI gate (#1260).
- [x] Security review — no unresolved high/critical; internal findings remediated
      through #1526/#1528/#1529/#1531.
- [x] Full pledge→escrow→refund/release loop verified on Base Sepolia against
      the current UUPS proxy ([refund run](https://github.com/akoita/resonate/actions/runs/30953444911),
      [fee/release run](https://github.com/akoita/resonate/actions/runs/31294684777)).

**Go-live ops (only on go-decision):**
- [ ] Deploy production `ShowCampaignEscrow`; promote the address into prod config (`resonate-iac` / Cloud Run / Secret Manager) and `web/src/contracts_abi`.
- [ ] Wire per-campaign `contractCampaignId` and verify on the production chain.
- [ ] `ENABLE_SHOWS_ESCROW_INDEXER` on in prod; reconciliation + alerting verified.
- [ ] Seeded `CAMPAIGNS[]` web fallback gated/removed for production builds.
- [ ] Controlled launch: small real-user cohort, monitored end to end.
- [ ] Flip Shows status from `partial`/staging to *live* once real users are served.

## Risks / gates

- **No production deployment** without the explicit owner GO and launch package
  tracked in #1583 — a green engineering gate alone is insufficient.
- **Remix GPU cost/latency** is the Sprint-2 risk — spike #1206 before committing downstream work.
- **Solo bandwidth:** 4 weeks ≈ 2 sprints; front-loaded on production-grade hardening (lower risk) before opening Remix (higher risk).

_Source of truth for live status is the GitHub issues/milestone; this doc is the committed plan snapshot._
