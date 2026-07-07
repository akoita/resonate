# Sprint Plan: Vision Sprint 5 — Generation-to-Ownership

**Dates:** Mon 2026-07-07 → Fri 2026-07-25 (indicative)
**Team:** 1 engineer ([@akoita](https://github.com/akoita)) + AI agents
**Milestone:** [Vision Sprint 5: generation-to-ownership](https://github.com/akoita/resonate/milestone/7)
**Tracker filter:** [`label:sprint:vision-5`](https://github.com/akoita/resonate/issues?q=is%3Aissue+is%3Aopen+label%3Asprint%3Avision-5)
**Working mode:** flexible priority-set sprint — see [docs/sprints/README.md](README.md)
**Revenue line:** (2) Artist Pro + generation credits — the ADR-BM-6 next line after (1) Shows fees and (3) marketplace take-rate, both shipped.

> **Sprint Goal:** AI-assisted creation becomes a **metered, fair, trust-gated
> capability whose output feeds sellable ownership products** — turning the
> already-deployed GPU from a silent cost center into the creative on-ramp to
> creator commerce, and doing it *at cost + margin* so the artist's 85%+ on fan
> money is never touched. If, at demo, an artist can generate a rights-clean
> remix, it is metered fairly and transparently, and the result can be listed
> as an ownership product fans could buy — the sprint hit.

## Vision alignment (why this sprint, framed to serve the vision)

The current vision (business-model review 2026-07):

> *Resonate is the direct-to-fan and direct-to-creator commerce platform for
> music — streaming is the storefront, ownership and participation are the
> products, and artists keep 85%+.* North-star: **median monthly take-home per
> active artist.**

This sprint serves that vision on four counts — and is deliberately shaped so
it is **not** a mere "charge artists for GPU" margin grab:

1. **Generation is the creative supply for ownership products.** Artists use
   AI-assisted remix to *produce* the stems/remixes/derivatives that become the
   ownership products fans buy. This sprint makes that production real and wires
   its output toward sellable ownership — feeding the fan→artist commerce
   flywheel (and thus artist take-home), not just platform margin.
2. **The 85%+ is untouched.** Generation credits are a **tool cost priced at
   cost + margin** (ADR-BM-3, ~$0.10/30s), explicitly *separate* from the
   transaction split. The platform's margin line is what lets it *afford* the
   generous fan→artist splits — it is not a cut of the artist's fan revenue
   (ADR-BM-4 red lines respected).
3. **Trust and AI transparency.** The pre-launch gates (Stability attribution,
   prompt-safety moderation) are the "fair" in the vision and the concern of the
   AI-Music-Integrity epic (#1164) — real users only meet the generation path
   once it is attributed and safe.
4. **Special opportunity / economics.** The hard part — deploying scale-to-zero
   GPU inference (Stable Audio 3, resonate-iac#176) — is done and *already
   costing money on every render* while earning nothing. The marginal work to
   turn it into a fair margin line that also feeds commerce is small relative to
   the value sitting idle.

## Priorities

| Tier | Item | What / exit condition |
| --- | --- | --- |
| **P0** | Generation-credit ledger + per-render metering ([#1334](https://github.com/akoita/resonate/issues/1334)) | A credit ledger + per-generation debit at the ADR-BM-3 rate (~$0.10/30s), with a clear "cost + margin, not a fan-revenue cut" model. **Staging scope:** the *meter* is proven end-to-end (a generation debits credits; insufficient credits blocks); live fiat top-up stays behind an operator flag (production flip later). **Exit:** a remix generation debits the artist's credit balance on staging; zero balance blocks generation with a clear message. |
| **P0** | Pre-launch trust gate: Stability attribution ([#1342](https://github.com/akoita/resonate/issues/1342)) | "Powered by Stability AI" + license links in Remix Studio wherever the audio-conditioned path is used. **Exit:** attribution + license visible on every audio-conditioned generation surface. |
| **P0** | Pre-launch trust gate: prompt-safety moderation ([#1343](https://github.com/akoita/resonate/issues/1343)) | Moderation on the self-hosted audio-conditioned generation path (block/deny unsafe prompts, logged). **Exit:** unsafe prompts are refused before hitting the worker; decisions auditable. |
| **P1** | Remix Studio MVP surface ([#891](https://github.com/akoita/resonate/issues/891)) | The rights-gated AI-assisted remix workflow that consumes credits — the creation surface. **Exit:** an artist completes a rights-clean remix that debits credits and passes the trust gates. |
| **P1** | Creation→commerce bridge (**new**) | Generated/remixed output becomes a *listable ownership product* (a stem/remix listing via the existing marketplace path). This is the north-star tie — generation feeds artist take-home, not only platform margin. **Exit:** a remix produced in-app can be listed for sale (rights-gated), closing the create→own→sell loop. |
| **P2 / stretch** | Artist Pro subscription wrapper (Stripe v1) | Bundle credits + creator tools under an Artist Pro tier (Stripe fiat v1, operator-flagged). Likely next sprint; scoped here only if P0/P1 land early. |

## Operator inputs required (only @akoita can provide)

- **Stability AI registration** (free) — the attribution/license terms the #1342
  gate must display, and the account under which the self-hosted audio-conditioned
  provider operates (flagged earlier as the ADR-BM-3 prerequisite, #1342 area).
- **Credit pricing sign-off** — confirm the ADR-BM-3 ~$0.10/30s number (or a
  revised figure) as the canonical rate; it lands in `docs/rfc/business-model.md`.
- **Stripe account** — only needed for the P2 fiat top-up; not required for the
  P0 staging meter.

## Explicitly NOT in this sprint

- **Live fiat charging** — the credit *meter* is built and proven on staging;
  real Stripe charging stays behind an operator flag (production flip, per the
  staging-only posture, #1271).
- **Listener Pro (line 4)** — gated on community density (~500–1,000 WAU) not
  yet met.
- **LicenseRegistry / recursive royalties (line 5)** — later roadmap phase.
- **Full Remix Studio epic (#1311)** — this sprint delivers the MVP slice + the
  commerce bridge; arrangement/per-stem/session depth stays in the epic.

## Exit criteria

- [ ] A remix generation on staging debits the artist's credit balance; zero
      balance blocks with a clear message (the fair meter).
- [ ] Every audio-conditioned generation surface shows Stability attribution +
      license links; unsafe prompts are refused and logged.
- [ ] An artist completes a rights-clean AI-assisted remix in Remix Studio.
- [ ] A remix produced in-app can be **listed as an ownership product** (the
      create→own→sell loop closes).
- [ ] Credit pricing reconciled into `docs/rfc/business-model.md`.
- [ ] Any mid-sprint re-scope recorded here with a dated note.

## Business-model conformance

Serves **revenue line (2)** directly (ADR-BM-6 next line). **ADR-BM-4 red lines
respected:** generation credits are a tool cost at cost + margin, *separate from*
the fan→artist transaction split — the artist keeps **85%+ of every fan
transaction**, untouched. No royalty-yield/income-share products; no
platform-subsidized payouts. Fee/price numbers reconcile into the single
canonical source (`docs/rfc/business-model.md`). The sprint advances the
north-star (artist take-home) by turning generation into creative supply for
sellable ownership products, and funds the generous splits with a fair,
transparent margin line rather than a cut of artist revenue.
