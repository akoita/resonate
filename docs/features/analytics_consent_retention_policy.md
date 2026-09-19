---
title: "Analytics Consent And Retention Policy"
status: partial
owner: "@akoita"
issue: 963
---

# Analytics Consent And Retention Policy

## Status

`partial`

The analytics platform already stores privacy tier, consent basis, producer,
schema, lineage, and pseudonymous subject/actor identifiers in the shared
event envelope. Backend governance jobs can apply retention cleanup, deletion
propagation, consent withdrawal, redaction, and audit lineage through
`backend/src/modules/analytics/analytics_governance.service.ts`.

An erasure now reaches the BigQuery warehouse as well as Postgres: deletion
propagation and consent withdrawal remove or rebuild the person's rows in
`events_raw`, `events_clean` and `analytics_facts`, then recompute the affected
days of `analytics_views` from the facts that survive (#1770).

The server-side consent gate for client-emitted telemetry now exists (#1772,
backend slice): the three authenticated browser ingest routes refuse to record
unless the person has an explicit granted decision. The user-facing surface for
making that decision is still missing, so the control exists only as an API in
this slice.

This page defines the product and operational policy that those jobs must
follow. The user-facing export shipped with #1771 slice 2 — a person downloads
their own data, analytics included, from Settings > Privacy; see
[Personal Data Rights](personal_data_rights.md). User-facing erasure (#1771
slice 3) and yearly listener summary controls still need product UI and operator
runbook work before this is complete.

## Who It Is For

- Listeners who need transparency, export, deletion, and summary controls for
  their activity history.
- Artists who need aggregate audience and catalog analytics without receiving
  raw listener identity.
- Operators and compliance reviewers who need clear retention and deletion
  behavior across Postgres, BigQuery, Dataflow, and derived reports.
- Developers adding analytics events, marts, or reports.

## Principles

- Capture broad product memory, but store the minimum useful identifiers.
- Prefer pseudonymous actor IDs and stable domain IDs over personal fields.
- Keep raw personal and sensitive records short-lived.
- Keep future value in facts and aggregate views that do not expose direct
  personal identity.
- Do not store prompts, notification bodies, payment proofs, private wallet
  material, exact IP addresses, user-agent strings, or other bulky raw content
  in analytics payloads.
- Keep artist-facing and listener-facing reports separated by default.
- Treat deletion, consent withdrawal, and retention cleanup as replayable
  pipeline events with lineage, not as manual table edits.

## Consent And Controls

Resonate should expose the following controls before treating analytics
summaries as a mature product surface:

| Control | Behavior |
| --- | --- |
| Product analytics preference | **Live (#1772).** A persistent banner asks once; Settings > Privacy changes the answer later. Refusing is exactly as prominent as accepting, nothing is preselected, and the browser stops emitting before a request is made. Required operational, security, payment, rights, and fraud events may still be captured under the appropriate legal basis. |
| Yearly summary preference | Lets listeners opt in or out of personalized yearly summaries such as Wrapped-style recaps. Opting out disables summary generation from future eligible facts and hides generated summary surfaces. |
| Analytics export | Exports the user's linked personal and pseudonymous analytics facts, plus plain-language explanations of aggregate-only data that cannot be attributed back to them. |
| Analytics deletion | Deletes or redacts raw and fact rows linked to the user's actor ID or subject IDs, except financial/audit facts that must be preserved with personal fields minimized. |
| Consent withdrawal | Applies deletion/redaction to events captured under a withdrawn `consentBasis`, then records lineage so future backfills do not recreate removed rows. |
| Artist privacy boundary | Artists see aggregate catalog and fan behavior metrics, not raw listener event streams or listener actor IDs. |
| Taste memory controls | Lets listeners reset recommendation taste memory, hide/downrank safe signals, and keep social taste matching disabled unless explicitly enabled. |

Every personal or sensitive analytics event must include `consentBasis`.
Pseudonymous behavior events should include it when tied to an authenticated
user preference, even when the current backend accepts pseudonymous events
without one.

### The Consent Rule

**Client-emitted telemetry is consent-gated. Server-emitted domain records are
not.**

The boundary is the ingest surface, not the event name. The taxonomy mixes
money and telemetry inside the same event families — `agent.purchase_completed`
sits beside `agent.intent_viewed`, `remix.published` beside
`remix.cta_impression` — so classifying individual event names would either
over-collect or drop a record the platform is obliged to keep.

- **Consent-gated (optional product analytics).** Everything a browser posts to
  the three authenticated telemetry routes:
  `POST /analytics/playback/completed`, `POST /analytics/playback/event`, and
  `POST /analytics/product/event`. These are recorded only when the
  authenticated person has an explicit granted decision, and the resulting
  events carry `consentBasis: "consent"`.
- **Not gated.** The server-side `record*` calls for commerce, rights,
  contract, generation and similar domain records. Each is a record of
  something that happened and runs under performance of contract or a legal
  obligation, with its own `consentBasis`. Consent withdrawal does not erase
  them; the audit-preserving redaction rules above apply instead.
- `POST /analytics/ingest` is a service-to-service route with no authenticated
  user and is not part of the browser telemetry surface.

**No decision means no optional collection.** A missing decision is refusal, not
permission: GDPR Article 7 requires a clear affirmative act, so a person who has
never been asked has not consented. The gate
(`AnalyticsConsentService.isProductAnalyticsAllowed`) returns false for an
absent decision, for a refusal, for an absent or empty user id, and for a
decision given against superseded consent text. A refused request is not an
error — the route answers `202` with
`{ "recorded": false, "reason": "consent_not_granted" }` and writes nothing, so
a client can see the refusal and stop emitting.

The decision is stored per user in `AnalyticsConsent` (`productAnalytics`,
`decidedAt`, `policyVersion`), cascades away with the user record, and is read
and written strictly for the authenticated user — no endpoint accepts a user id
from a body or query parameter, because an endpoint that can be pointed at
another account is a way to switch off someone else's privacy choice.

**The policy version is server-authoritative.** `policyVersion` records which
consent text the person agreed to, which is the evidence that the consent was
informed — so the server stores its own constant
(`ANALYTICS_CONSENT_POLICY_VERSION` in
`backend/src/modules/analytics/analytics_consent.service.ts`) and never a string
the client supplied. The constant lives in code rather than configuration
because it versions the wording the product ships: bump it in the same commit
that changes that wording. A client must still declare which version it
displayed, and a mismatch is refused with `409` and
`{ "error": "policy_version_stale", "currentVersion": "…" }`, so a stale browser
showing outdated text reloads and re-asks instead of recording an answer against
wording the person never saw.

**A decision is scoped to the version it was given against.** Consent covers
the processing that was described when it was given, so once that description
materially changes, prior consent does not extend to the new version — the gate
requires `policyVersion` to equal the current constant as well as
`productAnalytics: true`. The stored version is read, not merely recorded.

**Bump the constant only for a material change.** A typo fix or a reworded
sentence must not bump it. Every bump closes the gate for everyone until they
decide again, and re-asking people about nothing trains them to click through,
which degrades every consent that follows. The version must mean "what we do
with your data changed", never "we edited the copy".

Clients have three states to render, and the server computes which one applies
so that every client agrees:

| State | `decided` | `needsDecision` | Meaning |
| --- | --- | --- | --- |
| Never decided | `false` | `true` | Ask. No optional collection in the meantime. |
| Decided against the current text | `true` | `false` | Do not ask again — including when the decision was a refusal. Someone who said no has decided, and re-prompting them on the next page load is nagging, which undermines the validity of the refusal. |
| Decided against superseded text | `true` | `true` | Ask again. The gate is closed until they decide under the current text. |

Consent API (this slice; no user-facing surface yet):

| Endpoint | Behavior |
| --- | --- |
| `GET /analytics/consent` | Returns the authenticated user's decision as `{ productAnalytics, decided, needsDecision, policyVersion?, decidedAt?, currentPolicyVersion }`. `decided: false` means nothing has been recorded; `needsDecision` is computed server-side and is the value a client should branch on; `currentPolicyVersion` is the version a client must echo back on `PUT`. |
| `PUT /analytics/consent` | Takes `{ productAnalytics: boolean, policyVersion: string }`. Records the decision for the authenticated user against the server's policy version and moves `decidedAt` on every explicit decision. Answers `409 policy_version_stale` and writes nothing when the declared version is not the current one. |

## Retention By Layer

| Layer | Default Retention | Notes |
| --- | --- | --- |
| Postgres `AnalyticsEvent` sensitive raw events | 90 days | Configured by `ANALYTICS_RETENTION_SENSITIVE_DAYS`; delete unless financial/audit preservation requires redaction. |
| Postgres `AnalyticsEvent` personal raw events | 395 days | Configured by `ANALYTICS_RETENTION_PERSONAL_DAYS`; aligns with the 13-month warehouse window in compliance docs. |
| Postgres `AnalyticsEvent` pseudonymous raw events | 730 days | Configured by `ANALYTICS_RETENTION_PSEUDONYMOUS_DAYS`; enough for replay, cohorts, long sessions, and annual summaries. |
| BigQuery `events_raw` | Same class as source event | Raw warehouse retention must mirror the event privacy tier and governance log state. |
| BigQuery `events_clean` | Same class as source event unless transformed to fact-only form | Clean rows are replay inputs and must not outlive raw retention if they retain actor/session identifiers. |
| BigQuery `analytics_facts` | 24 months for user-linked behavior facts; 7-10 years for financial/audit facts | User-linked facts can support annual summaries and churn/cohort reporting. Financial, payout, royalty, dispute, settlement, rights, and tax/audit facts keep lawful history with personal fields minimized. |
| BigQuery `analytics_views` | Indefinite when anonymous or k-anonymous | Artist dashboards, product funnels, and summary aggregates may be retained while commercially useful if users cannot reasonably be reidentified. |
| `analytics_quarantine` | 30 days for personal/sensitive payloads; 90 days for pseudonymous malformed records | Quarantine exists to fix pipeline loss, not as a shadow raw store. Keep reason/event metadata after payload deletion when useful. |
| Governance lineage | Indefinite | Deletion, redaction, consent withdrawal, retention cleanup, and backfill lineage must remain to prove cleanup occurred. |

Any retention longer than these defaults needs a documented purpose, data
owner, access boundary, and deletion behavior.

## Export And Deletion Propagation

User export/delete and consent withdrawal must propagate through the full
analytics path:

1. Resolve the authenticated user to every linked analytics subject: user ID,
   pseudonymous actor ID, wallet subjects, artist profile subjects, active
   session IDs when available, and relevant release/track ownership IDs for
   artist-side exports.
2. Mutate the warehouse while holding the same exclusive lock as its loader.
3. Write governance lineage and delete non-audit raw, clean, and fact rows linked to the user or withdrawn
   consent basis.
4. Redact financial/audit rows instead of deleting lawful transaction history.
   Keep event name, dates, amounts, settlement/rights status, and source refs
   only when required for accounting, fraud, rights, or legal obligations.
5. Recompute or invalidate dependent views and marts so deleted rows do not
   reappear after a cache refresh, Dataflow retry, or BigQuery backfill.
6. Keep aggregate rows only when they remain anonymous or meet the approved
   aggregation threshold for the report.
7. Mark historical summary artifacts as revoked or regenerate them without the
   deleted facts.

Backfills must read governance lineage and tombstones before writing derived
facts. A backfill that ignores deletion lineage is considered unsafe.

### What The Backend Does Today

`AnalyticsGovernanceService.propagateDeletion` and `withdrawConsent` apply the
warehouse decision first, while holding the same exclusive mutation lock as
every BigQuery loader, and only then applies the Postgres decision per event
(delete, or redact for the audit-preserved `commerce`, `payment`, `rights` and
`license` families) in
`backend/src/modules/analytics/analytics_warehouse_governance.ts`:

- **Deleted events** are removed from `events_raw`, `events_clean` and
  `analytics_facts` in one transaction per chunk of 500 event IDs.
- **Redacted events** are projected into their redacted envelope before either
  store is mutated, and their warehouse rows are rebuilt and replaced by key.
  Warehouse redaction is therefore identical to Postgres redaction by
  construction, rather than a second set of rules that can drift.
- **`analytics_views` is recomputed, not patched**: the erasure collects the
  occurrence dates it touched and re-aggregates those whole days from the
  surviving `analytics_facts` rows, so the erased person's contribution leaves
  the daily counts instead of persisting inside them. View rows derived from
  only the erased events are deliberately discarded before writing, because a
  row aggregated from a handful of events would overwrite a day's real totals.
- **`analytics_quarantine` is not written** by the erasure. It holds envelopes
  that failed validation and never became person rows; it is governed by its own
  retention window in the table above. A redacted event that cannot be rebuilt
  (and would therefore be quarantined) fails the erasure loudly instead of
  leaving un-redacted rows behind.
- Ordering and locking matter: warehouse first preserves the Postgres event ids
  when BigQuery temporarily refuses DML against streaming-buffer rows. The
  shared loader/governance lock prevents a warehouse load from reintroducing a
  row between the warehouse mutation and the Postgres mutation.
- A warehouse failure is returned as `warehouse.status = "failed"`, written to
  lineage, and leaves Postgres untouched. Account closure remains pending, the
  scheduled execution exits non-zero, and a later run can retry after the
  temporary warehouse condition clears. Sign-in can still cancel that pending
  request.
- Deployments without a BigQuery warehouse (`ANALYTICS_WAREHOUSE_TARGET` unset
  or `local_json`) get a disabled target that reports `skipped` and performs no
  work. No new environment variable is involved.

**Retention cleanup is on this path too, as of #1789.** It used to call
`deleteEvent` and `redactEvent` directly rather than going through
`applyDeletionPolicy`, so it was the one governance action that stopped at
Postgres: an event past its window was removed from `prisma.analyticsEvent` and
left in the warehouse, which meant the windows in the table above were enforced
only in the copy that is not the long-lived one.

It now goes through the same path as an erasure, with one difference visible in
the lineage: retention writes a per-event action of `retention_deleted` or
`retention_redacted`, while the single batch-level `warehouse_erasure` row is
labelled `sourceAction: "retention"`. A tier with nothing expired makes no
warehouse call at all.

The scheduled entry point is `backend/src/scripts/run_retention_cleanup.ts`,
with the operator procedure in
[Analytics Retention Runbook](../operations/analytics_retention_runbook.md). It
is a script rather than a scheduled HTTP call because every route on
`MaintenanceController` requires a JWT plus an admin role, which a scheduled
caller cannot mint — the mechanical reason retention went unscheduled.

The order in which the two halves landed was not arbitrary: retention derives
its event ids from the Postgres rows, so a run against the pre-#1801 code would
have purged Postgres and left every corresponding warehouse row permanently
unreachable. Propagation had to land first.

**Size the first run with `--dry-run` before scheduling it.** Against a ledger
that has never been pruned, the first real execution is the largest single
governance action the system takes.

## Yearly Summary Rules

Yearly listener summaries can use:

- pseudonymous playback facts such as track, artist, release, source, duration
  bucket, completion bucket, replay count, and listening day;
- playlist/library facts such as save/add/remove counts and playlist-to-play
  funnels;
- discovery facts such as search-to-play and marketplace-to-play paths;
- commerce facts such as purchase counts, assets, tiers, and settlement status
  after personal payment details are removed;
- coarse cohorts and trends that are safe to expose to the listener.

Yearly summaries must not use:

- raw prompts, notification bodies, support messages, free-form names, exact IP
  addresses, device fingerprints, payment proofs, or private wallet data;
- artist-facing aggregate data to infer another listener's behavior;
- deleted/redacted rows or rows captured after summary opt-out;
- low-count artist or listener cohorts that could identify another person.

Artist yearly reports should use artist-owned catalog facts and anonymous
audience aggregates. Listener yearly reports should use the listener's own
facts and platform-wide anonymous comparison baselines. Do not mix the two
without an explicit report contract.

## Developer Checklist

When adding analytics events or marts:

- Choose a privacy tier and consent/legal basis.
- Avoid personal fields in payloads; store stable IDs or coarse buckets.
- Add the event family to the taxonomy and warehouse allowlist when needed.
- Document whether the event can appear in listener reports, artist reports,
  operational reports, agent datasets, or financial/audit exports.
- Define retention and deletion behavior before shipping the event.
- Include governance lineage or deletion/backfill tests when the event feeds a
  durable fact or view.

## Current Surfaces

- Event envelope and validation:
  `backend/src/modules/analytics/analytics_event.ts`
- Governance implementation:
  `backend/src/modules/analytics/analytics_governance.service.ts`
- Consent gate and decision store:
  `backend/src/modules/analytics/analytics_consent.service.ts`
- Consent enforcement on the browser telemetry routes:
  `backend/src/modules/analytics/analytics.controller.ts`
- Admin retention trigger:
  `POST /admin/retention/cleanup`
- Analytics platform feature page:
  [Analytics Event Ledger](analytics_event_ledger.md)
- Taste memory controls:
  [Listener Taste Memory Controls](listener_taste_memory_controls.md)
- Long-term RFC:
  [Long-Term Analytics Event Ledger](../rfc/analytics-event-ledger.md)
- Compliance retention summary:
  [Security Review + Data Retention](../compliance/security_review_data_retention.md)
- Environment variables:
  [Environment Variables](../deployment/environment.md)

## Verification

- Governance behavior is covered by
  `backend/src/tests/analytics_governance.spec.ts` and
  `backend/src/tests/analytics_governance.integration.spec.ts`.
- Consent storage and gate behavior are covered by
  `backend/src/tests/analytics_consent.integration.spec.ts`; enforcement on the
  three telemetry routes and the consent endpoints by
  `backend/src/tests/analytics_consent.controller.http.spec.ts`.
- New analytics events should add unit or integration coverage for
  privacy-tier validation, allowed payload fields, deletion/redaction behavior,
  and downstream fact/view propagation when applicable.
