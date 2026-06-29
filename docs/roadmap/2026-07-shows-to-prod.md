# Roadmap — Shows to Production, then Remix (2026-06-29 → 2026-07-27)

**Window:** 4 weeks (~2 sprints) · **Owner:** [@akoita](https://github.com/akoita) (solo + AI-assisted)
**Locked theme:** ship Resonate Shows to **production for real users**, then open the Remix Studio MVP.

> Rationale: Shows is the closest-to-PMF, real-money feature but it's parked on
> test/staging. Finishing and launching a revenue feature beats opening a heavy
> new GPU-bound build (Remix). The custody-contract hardening is a shared
> prerequisite for both, so it comes first.

## Status snapshot (2026-06-29)

- **Shows MVP:** built + verified, **staging-validated, NOT in production for real users**. Milestone closed. Remaining = go-live ops + a custody hardening/security gate before real money.
- **Recently shipped:** custody hardening (RevenueEscrow/ContentProtection/PaymentAssetRegistry fuzz/invariant/formal/Certora/Gambit), stablecoin-default dispute reporting, non-blocking Halmos CI, honest Shows docs.
- **Only P0:** Remix Studio MVP ([#891](https://github.com/akoita/resonate/issues/891)).
- **Tracked hardening debt:** [#943](https://github.com/akoita/resonate/issues/943), [#944](https://github.com/akoita/resonate/issues/944), [#1260](https://github.com/akoita/resonate/issues/1260).

---

## Sprint 1 (wks 1–2, Jun 29 → Jul 10): de-risk & ship Shows to production

**Sprint goal:** a real user funds a real campaign with real money, on hardened, security-reviewed custody.

| Priority | Workstream | Concrete items | Exit criteria |
|---|---|---|---|
| P0 | **Close custody hardening** (#943/#944) | Certora specs for `StemMarketplaceV2` + `StemNFT` (last critical contracts without one); deepen marketplace invariants; run **Gambit** mutation on the 4 high-value targets and kill survivors | #943/#944 closeable; mutation score recorded |
| P0 | **Halmos → blocking** (part of #1260) | Refactor formal `check_*` off `vm.expectRevert` + reverted-`setUp`; drop `continue-on-error` in `.github/workflows/formal.yml` | Halmos is a required check |
| P0 | **Security review** (the gate) | `/security-review` + a focused manual pass on `ShowCampaignEscrow` + `RevenueEscrow` + `ContentProtection`; ideally one external audit pass | No unresolved high/critical findings |
| P0 | **Shows go-live ops** | Promote deployed `ShowCampaignEscrow` address → prod config; wire per-campaign `contractCampaignId`; env/seed; gate or flag the seeded `CAMPAIGNS[]` web fallback; controlled small-cohort launch | Real user funds a real campaign; Shows status flipped to *live* |

**Hard gate:** the hardening + security review must be green **before** real money goes live.

## Sprint 2 (wks 3–4, Jul 13 → Jul 27): Remix Studio MVP kickoff (#891)

| Priority | Item |
|---|---|
| P0 | Land design slice [#1182](https://github.com/akoita/resonate/issues/1182) (stem-grounded generation — licensed stems shape the output) |
| P0 | Adopt-gate [#1193](https://github.com/akoita/resonate/issues/1193) (Stable Audio 3 GPU quality spike + Stability/Gemma license review) |
| P1 | Spike [#1206](https://github.com/akoita/resonate/issues/1206) — audio-conditioned generation provider + warm GPU inference service (**gate on cost/latency before building on it**) |
| P1 | Wire rights-gating (remix-tier purchase already unlocks Remix Studio via #1141) |
| P2 (bg) | AI DJ taste #977 / Artist cockpit #1121 tick; schedule Certora/Gambit workflows (#1260) |

---

## Shows production go-live checklist

- [ ] Custody hardening closed (#943/#944) — fuzz/invariant/formal/Certora across all custody contracts; Gambit survivors addressed.
- [ ] Halmos promoted to a blocking CI gate (#1260).
- [ ] Security review of `ShowCampaignEscrow`, `RevenueEscrow`, `ContentProtection` — no unresolved high/critical.
- [ ] Production `ShowCampaignEscrow` deployed + address promoted into prod config (`resonate-iac` / Cloud Run / Secret Manager) and `web/src/contracts_abi`.
- [ ] Per-campaign `contractCampaignId` wiring verified end-to-end on the production chain.
- [ ] `ENABLE_SHOWS_ESCROW_INDEXER` on in prod; reconciliation + `shows.campaign_reconciliation_mismatch` alerting verified.
- [ ] Seeded `CAMPAIGNS[]` web fallback gated/removed for production builds.
- [ ] Controlled launch: small real-user cohort, monitored pledge→escrow→receipt→refund/release.
- [ ] Feature catalog + User Guide flipped from `partial`/staging to *live* once real users are served.

## Risks / gates

- **Real money before review = no.** Don't launch Shows to real users before the hardening + security gate.
- **Remix GPU cost/latency** is the Sprint-2 risk — spike #1206 before committing downstream work.
- **Solo bandwidth:** 4 weeks ≈ 2 sprints; front-loaded on finishing Shows (lower risk) before opening Remix (higher risk).

_Source of truth for live status is the GitHub issues/milestone; this doc is the committed plan snapshot._
