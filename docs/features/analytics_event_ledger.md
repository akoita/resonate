---
title: "Analytics Event Ledger"
status: partial
owner: "@akoita"
issue: 867
---

# Analytics Event Ledger

## Status

`partial`

The backend now has a shared analytics event envelope, runtime validation, and
sample event-family schemas in
`backend/src/modules/analytics/analytics_event.ts`. Raw event envelopes are
persisted through the Postgres-backed `AnalyticsEvent` ledger model via
`backend/src/modules/analytics/analytics_event_store.ts`, with an in-memory
fallback only for direct unit-test construction outside Nest dependency
injection. The first warehouse export contract is available through
`backend/src/modules/analytics/analytics_warehouse.ts`; it emits raw, clean,
fact, view, and quarantine layers from stored events. Core producer helpers for
playback, library, commerce, rights, agent, and generation events are available
in `backend/src/modules/analytics/analytics_instrumentation.service.ts`; the
web player records qualifying `playback.completed` events through the narrow
`POST /analytics/playback/completed` endpoint after a catalog track reaches 30
seconds listened or 80 percent completion for shorter tracks.
Upload/catalog processing events are bridged from the shared backend `EventBus`
by `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`,
so release upload, stem processing, track-status, failure, and release-ready
signals enter the ledger and optional Pub/Sub/Dataflow path during normal
product flows. The same bridge now also maps high-value commerce, license,
payment, contract, wallet, agent-runtime, generation, recommendation,
curation, remix, marketplace, release-rights, and notification events into
compact pseudonymous analytics envelopes, excluding bulky user-supplied text
such as generation prompts and notification bodies.
Retention cleanup, deletion propagation, consent withdrawal, and governance
lineage are available in
`backend/src/modules/analytics/analytics_governance.service.ts`, and the admin
retention endpoint invokes analytics cleanup. A first operational warehouse
loader is available in
`backend/src/modules/analytics/analytics_warehouse_loader.ts`; it can backfill
stored events into idempotent JSONL layer files outside process memory and
quarantines unsupported event versions before they reach clean/fact/view layers.
Deployed environments can set `ANALYTICS_WAREHOUSE_TARGET=bigquery_insert_all`
to stream those layers into the configured BigQuery dataset through Google ADC.
Current artist analytics endpoints consume the generated fact/view layers
instead of aggregating directly from raw in-memory events, and deployed
backends can set `ANALYTICS_REPORT_SOURCE=bigquery` to read artist dashboard
metrics from BigQuery with bounded artist/time-window queries, freshness
metadata, short TTL caching, and rights-route dimensions for content protection
metrics. Artist dashboard responses also enrich track facts from catalog
metadata when events contain `trackId` but omit display titles. The
near-real-time target path can also
publish validated envelopes to Pub/Sub after ledger
persistence by setting `ANALYTICS_EVENT_PUBLISHING_ENABLED=true` and
`ANALYTICS_EVENT_PUBSUB_TOPIC` to the Terraform-managed analytics topic. The
first Dataflow processor artifact is available in
`workers/analytics-dataflow/`; it packages an Apache Beam streaming pipeline as
a Flex Template that can consume the Terraform-managed subscription and write
raw, clean, fact, view, and quarantine rows to BigQuery. The
`Publish Analytics Dataflow Flex Template` GitHub Actions workflow builds the
worker image, pushes it to environment-scoped Artifact Registry, publishes the
Flex Template spec JSON to GCS, and prints the `resonate-iac` launch inputs for
`analytics_dataflow_launch_enabled=true`. Post-Dataflow SQL materializations
live under `workers/analytics-dataflow/sql/`; the first derived feature set
creates agent taste-intelligence tables for warehouse-backed recommendation
scoring.

## Who It Is For

- Product and growth teams measuring adoption, funnels, retention, demand, and
  feature health.
- Artists understanding plays, purchases, payouts, and fan behavior in
  aggregate.
- Operators producing rights, disputes, commerce, abuse, marketplace, and
  compliance reports.
- Agents and recommendation systems learning from replayable product events.
- Developers adding instrumentation without inventing one-off report shapes.

## Value

The ledger keeps Resonate from losing product memory. New features should emit
stable domain events as they happen, even when no current screen or report uses
them yet. Years later, the team can build cohorts, funnels, payout reports,
agent-learning datasets, trust metrics, marketplace analysis, audit exports,
artist statements, and reports for features we have not imagined yet from
historical facts instead of guessing.

Long-term usefulness comes from governed pseudonymous facts and anonymous
aggregates, not from retaining raw personal data forever.

## How To Use Today

- Read the RFC:
  [Long-Term Analytics Event Ledger](../rfc/analytics-event-ledger.md).
- Use the event taxonomy:
  [Event Taxonomy & Domain Model](../architecture/event_taxonomy_domain_model.md).
- For the current artist dashboard/reporting surface, see:
  [Analytics Dashboard v0](analytics_dashboard_v0.md).
- Backend producers should use the shared event contract:
  `backend/src/modules/analytics/analytics_event.ts`.
- Cross-cutting analytics subscribers should listen on the process-level
  `EventBus` from `SharedModule`; feature modules should not provide local
  `EventBus` instances for production flows.
- Current prototype API surfaces:
  - `POST /analytics/ingest`
  - `GET /analytics/artist/:id`
  - `GET /analytics/artist/:id/v1`
  - `GET /analytics/rollup/daily`
  - `GET /analytics/export/layers`
- Admin/operator warehouse load surfaces:
  - `POST /admin/analytics/warehouse/load`
  - `POST /admin/analytics/warehouse/backfill`

## Expected Platform Surfaces

| Surface | Purpose |
| --- | --- |
| Analytics event SDK | Implemented in `backend/src/modules/analytics/analytics_event.ts`: shared event envelope, validators, schema examples, privacy tiers, and idempotency helper conventions. |
| Durable ingestion | Implemented for local/backend runtime with the Postgres `AnalyticsEvent` raw ledger and idempotent `eventId` upserts. |
| `events_raw` | Implemented export layer for append-only received events used for replay and backfill. |
| `events_clean` | Implemented export layer for validated, normalized event records. |
| `analytics_facts` | Implemented export layer for long-lived pseudonymous product, commerce, rights, and agent facts. |
| `analytics_views` | Implemented export layer for report/API/export/UI-ready aggregates. |
| `analytics_quarantine` | Implemented export layer for invalid or unsupported records that must not be silently dropped. |
| Pub/Sub event publishing | Implemented as a disabled-by-default backend publisher. When enabled, each stored envelope is published with event metadata attributes for Dataflow consumers; non-strict failures are logged without breaking user flows. |
| Dataflow processor | Implemented in `workers/analytics-dataflow/` as a Python Apache Beam streaming pipeline with Flex Template metadata, packaging script, eventId windowed dedupe, validation, layer derivation, and quarantine behavior. |
| Flex Template publishing | Implemented through `.github/workflows/publish-analytics-dataflow-flex-template.yml`; staging publishes to a stable `gs://.../template.json` path and outputs the matching `resonate-iac` launch inputs. |
| Agent taste materialization | Implemented as post-Dataflow BigQuery SQL in `workers/analytics-dataflow/sql/agent_taste_intelligence_baseline.sql`, with an optional BigQuery ML matrix-factorization template in `agent_taste_intelligence_bqml.sql`. |
| Warehouse loading/backfill | Implemented through `ANALYTICS_WAREHOUSE_TARGET=local_json` for idempotent JSONL files and `ANALYTICS_WAREHOUSE_TARGET=bigquery_insert_all` for BigQuery streaming inserts across raw, clean, fact, view, and quarantine layers. This remains the operational bridge while the Dataflow path is validated. |
| Current artist reports | Implemented for `GET /analytics/artist/:id` and `GET /analytics/artist/:id/v1`; reports read generated analytics facts and fact dimensions while preserving response compatibility. With `ANALYTICS_REPORT_SOURCE=bigquery`, the same endpoints read BigQuery `analytics_facts` and `analytics_views`, enforce artist/admin authorization, return explicit time-window/freshness/no-data metadata, compute content protection metrics from `rights.route_decided`, and use bounded cached queries. |
| Catalog metadata enrichment | Implemented in `backend/src/modules/analytics/analytics_catalog_metadata.service.ts`; artist analytics responses resolve track/release/artist display metadata from catalog rows when analytics facts have IDs but sparse dimensions. |
| Core producer helpers | Implemented in `backend/src/modules/analytics/analytics_instrumentation.service.ts` for playback, library, commerce, rights, agent, and generation events. |
| Playback web instrumentation | Implemented through `POST /analytics/playback/completed`, `web/src/lib/playbackAnalytics.ts`, and `web/src/lib/playerContext.tsx`; authenticated web-player catalog plays emit one `playback.completed` envelope per track load once the qualifying threshold is reached. |
| Upload/catalog domain bridge | Implemented in `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`; subscribes to the shared `EventBus` for upload and catalog lifecycle events and ingests compact pseudonymous analytics envelopes without blocking release processing. |
| High-value domain bridge | Implemented in `backend/src/modules/analytics/analytics_domain_event_bridge.service.ts`; subscribes to shared `EventBus` events for license/payment, contract sales/listings/royalties/disputes, wallet funding/spend, agent selection/decisions/purchases, generation lifecycle, recommendation generation, curation, remix, marketplace listing notifications, release-rights requests, and notification creation. The bridge preserves IDs, amounts, statuses, and source refs while omitting prompts, notification bodies, and other bulky raw content. |
| Domain family support | Backend warehouse export and Dataflow both accept the current Resonate domain families: identity, wallet, catalog, stems, ingestion, ipnft, session, playback, library, commerce, payment, contract, x402, license, rights, release_rights, agent, recommendation, curator, remix, marketplace, generation, notification, realtime, experiment, and system. |
| Retention/deletion jobs | Implemented in `backend/src/modules/analytics/analytics_governance.service.ts`: retention cleanup, deletion propagation, consent withdrawal, redaction, and lineage audit. |

## Event Families

Implemented producer helper event names:

- `playback.completed`
- `library.saved`
- `commerce.settled`
- `rights.route_decided`
- `agent.recommendation_selected`
- `generation.created`

Implemented upload/catalog bridge event names:

- `stems.uploaded`
- `stems.processed`
- `stems.failed`
- `catalog.track_status`
- `catalog.release_ready`

Implemented high-value domain bridge event names:

- `license.granted`
- `payment.initiated`
- `payment.settled`
- `contract.stem_listed`
- `contract.stem_sold`
- `contract.royalty_paid`
- selected `contract.dispute_*` and content-protection dispute events
- `agent.purchase_completed`
- `agent.purchase_failed`
- `agent.track_selected`
- `agent.decision_made`
- `generation.started`
- `generation.completed`
- `generation.failed`
- `recommendation.generated`
- `wallet.funded`
- `wallet.spent`
- `curator.staked`
- `curator.reported`
- `remix.created`
- `release_rights.request_updated`
- `marketplace.listing_notify`
- `notification.created`

The warehouse/Dataflow processors accept the domain families listed in
[Event Taxonomy & Domain Model](../architecture/event_taxonomy_domain_model.md),
so these bridged events can flow without family renaming just to avoid
quarantine.

## Verification

Current verification:

- New durable features should identify the event family they emit into.
- Feature docs should list important analytics events.
- Privacy-sensitive events should declare retention and deletion behavior.
- Event envelope validation is covered by
  `backend/src/tests/analytics_event.spec.ts`.
- Warehouse export transforms, quarantine behavior, and the shared expected
  event processing matrix are covered by
  `backend/src/tests/analytics_warehouse.spec.ts` using
  `test-fixtures/analytics_expected_events.json`.
- Warehouse loader idempotency, schema quarantine, and event-version parsing are
  covered by `backend/src/tests/analytics_warehouse_loader.spec.ts`.
- Pub/Sub event publishing config, attributes, disabled behavior, and
  non-strict/strict failure handling are covered by
  `backend/src/tests/analytics_event_publisher.spec.ts`.
- Dataflow transform validation, quarantine, dedupe, unsupported-version
  behavior, and the same shared expected event processing matrix are covered by
  `workers/analytics-dataflow/test_analytics_transform.py`.
- The Flex Template publish workflow is validated by GitHub Actions syntax
  checks and the worker transform tests; a successful workflow run publishes the
  operator handoff values needed by `resonate-iac`.
- BigQuery-backed artist report query shaping and no-data metadata are covered
  by `backend/src/tests/analytics_bigquery_report.spec.ts`.
- Catalog metadata enrichment for sparse artist report facts is covered by
  `backend/src/tests/analytics.spec.ts` and
  `backend/src/tests/analytics_catalog_metadata.integration.spec.ts`.
- Artist analytics API authorization is covered by
  `backend/src/tests/analytics.controller.http.spec.ts`.
- Durable backfill scoping is covered by
  `backend/src/tests/analytics_warehouse_loader.integration.spec.ts`.
- Core producer helper behavior is covered by
  `backend/src/tests/analytics_instrumentation.spec.ts` and
  `backend/src/tests/analytics_instrumentation.integration.spec.ts`.
- Playback endpoint and frontend qualification/API behavior are covered by
  `backend/src/tests/analytics.controller.http.spec.ts`,
  `web/src/lib/playbackAnalytics.test.ts`, and `web/src/lib/api.test.ts`.
- Upload/catalog domain bridge behavior is covered by
  `backend/src/tests/analytics_domain_event_bridge.spec.ts`.
- Retention/deletion/consent governance behavior is covered by
  `backend/src/tests/analytics_governance.spec.ts` and
  `backend/src/tests/analytics_governance.integration.spec.ts`.
- Future implementation PRs should include tests for durable ingestion,
  idempotency enforcement, and additional downstream report/fact behavior.

## Follow-Up Work

- [#879](https://github.com/akoita/resonate/issues/879) — add operational
  warehouse loading/backfill. JSONL and BigQuery insert-all targets are
  implemented; remaining future work is a managed Dataflow-style transform once
  that infrastructure dependency is chosen.
