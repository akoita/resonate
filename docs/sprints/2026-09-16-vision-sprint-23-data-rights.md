# Vision Sprint 23: Data rights the app can actually honor

**Status:** planned.
**Milestone:** [25](https://github.com/akoita/resonate/milestone/25).
**Goal:** A person in the v1 cohort can read what they are agreeing to, choose
what is collected about them, and have their data exported or erased
everywhere it landed.

## Approved scope and order

1. [#1769](https://github.com/akoita/resonate/issues/1769): publish the legal
   surface — Terms of Service, Privacy Policy, the refund promise for escrow
   pledges, and the imprint.
2. [#1770](https://github.com/akoita/resonate/issues/1770): make erasure reach
   the warehouse instead of stopping at Postgres.
3. [#1771](https://github.com/akoita/resonate/issues/1771): give people a door
   — data export and erasure in Settings.
4. [#1772](https://github.com/akoita/resonate/issues/1772): ask before
   collecting — a consent gate honored at the emitter and at ingest.
5. [#1766](https://github.com/akoita/resonate/issues/1766): make scheduled
   workflows report their failures.
6. [#1768](https://github.com/akoita/resonate/issues/1768): let Dependency
   Train open its review pull request.

Two items carry prerequisites the work cannot satisfy on its own. #1769 needs
the legal entity, its jurisdiction, and a contact address before the imprint
can be published truthfully; the other three documents can be drafted and
reviewed while that is pending. #1768 needs a GitHub App registered and its
secrets installed before the workflow change can be verified — the code can
land ahead of it.

Capacity is one focused workstream with no due date and no fixed capacity
commitment. There is no Sprint 22 carry-over; that milestone closed 6/6.

## Why this shape

[#1595](https://github.com/akoita/resonate/issues/1595) is the ledger that
decides what comes next, and section A — policies and legal — is the only
cluster where every box is still unchecked. The code agrees with the ledger:
`web/src` has no terms page, no privacy policy, no imprint and no consent
surface, and `backend/src` has no user-facing export or deletion path. The
triage behind that ledger does not hedge about what this means for a product
that moves USDC: *"Real money without ToS is not launchable."*

The second half of the theme comes from a gap the last two sprints opened
without anyone noticing. `analytics_governance.service.ts` already implements
erasure correctly — matching, retention policy, audit-preserving redaction,
lineage — but it only queries `prisma.analyticsEvent`. Since the Sprint 21
cutover the facts live in BigQuery, so an erasure today clears Postgres and
leaves the same person's rows in `analytics_facts`, `analytics_views` and
`events_clean`. The machinery is one system short of the truth, and it went
that way quietly when the warehouse stopped being a mirror and became the
store.

That ordering is deliberate. Propagation is fixed before the control that
promises it ships, because a delete button that leaves the warehouse intact is
worse than no delete button: it converts a missing feature into a false
statement.

The two automation items are not the theme, but they are the reason the theme
was found. Both were discovered on 2026-09-16 by reading the Actions tab:
`Mutation Testing (Gambit)` had been red every Monday since 2026-08-10 with the
three money contracts generating zero mutants
([#1764](https://github.com/akoita/resonate/issues/1764)), and
`Dependency Train` had never once succeeded. Four of six scheduled workflows
report their failures to nobody. A sprint that adds compliance machinery to a
repository whose weekly automation fails silently is building on sand.

## Exit and boundaries

A signed-out visitor can read the terms, the privacy policy, the refund
promise and the imprint. A signed-in user can export their data and request
erasure from Settings without an operator. After an erasure, no rows for that
actor remain in `analytics_facts`, `analytics_views` or `events_clean` on
staging, and a subsequent scheduled load does not reintroduce them. A user who
refuses consent generates no product events, verified at ingest rather than in
the browser. A forced scheduled-workflow failure leaves a visible trace. A
Monday `Dependency Train` run opens a review pull request that carries CI, or
the remaining operator step is stated.

The privacy policy states what cannot be erased — on-chain transactions, IPFS
content, and whatever the retention policy preserves for audit. That limit is
permanent and disclosing it honestly is part of the exit, not a caveat on it.

#1770 is a bounded slice of [#881](https://github.com/akoita/resonate/issues/881);
the historical reconciliation remainder of that epic stays open.

Excluded: production go-live and the #1583 go decision, the migration
(#1663), the `v*` software release plane (#1667), sections C and D of the
#1595 ledger (feature polish and the gate/hide work), marketplace and
community exposure decisions, and
[#1765](https://github.com/akoita/resonate/issues/1765), the recurrence guard
for the Gambit remappings.

Drafts of the legal documents are grounded in what the code does. They are not
legal advice and require owner review before publication.

This is vision-neutral infrastructure and quality (`vision:keep`). ADR-BM-6
revenue lines, fees, prices, splits and payouts are unchanged; the refund
document records the fee-free behavior that already exists rather than
creating it, and the Terms text is constrained by the ADR-BM-4 red lines.
