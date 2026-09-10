# Batch analytics operations

Use batch analytics for bounded, cost-sensitive warehouse updates. Streaming
remains a first-class near-real-time path. Streaming view insert IDs are scoped to each source event, so distinct events
on the same day are not collapsed by insert suppression. Both transform contracts are checked
against the shared event fixtures, including product actions, credited artist
identity, coarse geography, owner-remix attribution, and quarantine behavior.

## Sources and targets

The scheduled warehouse loader reads the governed Postgres analytics ledger.
The Pub/Sub `events_landing` subscription is retained for transport inspection;
it is not a second input to the same load. This prevents dual ingestion of the
same event. External producers must enter the governed ledger or use the
streaming path; this loader does not consume arbitrary landing-only messages.

| Target | Behavior |
| --- | --- |
| `local_json` | Durable keyed JSONL rows. Daily views are rebuilt from all stored unique facts so later windows update existing days. Serialize writers to the same directory. |
| `bigquery_insert_all` | Existing streaming-insert loader. `insertId` deduplication is best-effort; fact reads deduplicate, but physical rows and view snapshots can repeat. |
| `bigquery_batch` | Opt-in transactional replacement by event/fact/quarantine keys. Rebuilds affected daily views from durable unique facts, including earlier loads on those days. |

Batch requires explicit `[from, to)` timestamps spanning at most 31 days.
Each request is limited to 10,000 events and 8 MB of serialized export data;
split larger backfills into smaller windows. Database reads stop at 10,001 rows
and fail instead of silently truncating. Query cost uses
`ANALYTICS_BIGQUERY_MAXIMUM_BYTES_BILLED` (default 500 MB). Required IAM is
warehouse data editor plus BigQuery job user and schema read access.

BigQuery [transactions](https://docs.cloud.google.com/bigquery/docs/transactions)
provide atomic layer updates; its [DML concurrency rules](https://docs.cloud.google.com/bigquery/docs/data-manipulation-language#concurrent_jobs)
still require serialization for competing first inserts.

A load is successful only after the BigQuery transaction completes and its
per-layer result is read. A schema mismatch, invalid value, or DML conflict
fails the load. All layer mutations roll back together. Existing matching keys
are replaced, which also repairs duplicates and refreshes redacted rows when
those events are reloaded. Result `inserted` counts new keys; `updated` counts
replaced keys; neither is a count of newly observed user actions.

## Switch safely

1. Deploy the backend implementation and the companion IaC configuration
   support before choosing the new target.
2. Pause the warehouse schedule and wait for active loads to finish. Stop any
   Dataflow or other `insertAll` writer targeting the same warehouse.
3. Wait for legacy BigQuery streaming buffers to drain. They can prevent DML;
   never bypass a buffer conflict or report a failed transaction as success.
4. Set `analytics_warehouse_target = "bigquery_batch"` in the authoritative IaC
   environment configuration, review the plan, and deploy. Keep execution mode
   `batch`; no always-on Dataflow job is needed.
5. Run one bounded window, repeat it, then load an overlapping window. Compare
   raw/clean/fact counts and the daily totals against unique ledger events.
6. Resume scheduling. The app takes a Postgres advisory lock per project/dataset
   and rejects overlapping batch loads, including manual backfills. External
   writers must still stay paused: BigQuery does not enforce unique keys for
   concurrent first inserts. If a submitted job has an unknown outcome, inspect
   its recorded job ID and wait for completion/cancellation before retrying.

Step 6 is part of the cutover, not an optional follow-up. A schedule left
paused after step 2 is silent: the Pub/Sub landing table keeps filling, the job
reports no failure because it never runs, and the warehouse simply stops
advancing. Confirm the scheduler state after the cutover and compare the newest
warehoused event against the newest landed message before calling the switch
done.

To roll back, pause all writers, restore `bigquery_insert_all`, and resume the
existing schedule. Preserve read-side fact deduplication and check freshness.
Switching modes does not delete warehouse tables. Streaming resumes only after
batch loading stops and its transaction outcome is known.

## Close a stale window

A paused or failed schedule leaves a gap that resuming alone will not repair:
each scheduled run only covers `ANALYTICS_WAREHOUSE_LOAD_WINDOW_MINUTES` back
from its own start. Backfill the gap explicitly with bounded windows, using
execution-level overrides so the job definition stays untouched:

```bash
gcloud run jobs execute <load-job> --region <region> --project <project> --wait \
  --update-env-vars=ANALYTICS_WAREHOUSE_LOAD_FROM=<start>,ANALYTICS_WAREHOUSE_LOAD_TO=<end>
```

Keep each window inside the 31-day span, the 10,000-event request cap, and the
10,001-row ledger read cap; split larger gaps. Read the run's
`analytics.warehouse.load_succeeded` log line for `eventsRead`, `insertedRows`,
and `quarantinedRows`, then repeat the identical window: a correct rerun reads
the same events, inserts zero rows, and leaves every layer count unchanged.
Resume the schedule only after the last window lands.

## Privacy and retention boundary

Both paths enforce the event-envelope privacy/consent contract before promoting
rows. Malformed events and unsupported versions/families are quarantined.
The batch source reads current governed ledger rows, including redactions;
coarse geography is recovered from the persisted envelope and is absent when
that envelope has been redacted.

Neither path currently propagates a later ledger deletion into every previously
exported warehouse row. Warehouse retention remains infrastructure-managed;
historical deletion reconciliation is an existing broader analytics governance
gap under [#881](https://github.com/akoita/resonate/issues/881). Do not claim
that changing execution mode resolves it. Shared parity does not imply that
arbitrary historical data is safe to retain indefinitely.

## Verification

Focused checks from `backend/`:

```bash
npx jest --runInBand --runTestsByPath src/tests/analytics_warehouse_parity.spec.ts src/tests/analytics_warehouse_loader.spec.ts src/tests/analytics_bigquery_batch.spec.ts
npx jest --config jest.integration.config.js --runInBand --runTestsByPath src/tests/analytics_warehouse_loader.integration.spec.ts
npm run lint
```

The parity check needs Python 3 and no Beam/cloud packages. Run the Dataflow
suite with `python -m unittest test_analytics_transform.py` from
`workers/analytics-dataflow/`.

The optional external test creates an isolated expiring dataset, copies only
schemas from the selected warehouse, writes synthetic events, checks retries
and transaction rollback, and deletes its dataset:

```bash
NODE_OPTIONS=--experimental-vm-modules \
ANALYTICS_BATCH_TEST_PROJECT=<test-project> \
ANALYTICS_BATCH_TEST_SCHEMA_DATASET=<warehouse-dataset> \
npx jest --runInBand --runTestsByPath src/tests/analytics_bigquery_batch.external.spec.ts
```

It uses Application Default Credentials and is skipped unless both test
variables are set. No live warehouse rows are modified. Final staging acceptance
is [#932](https://github.com/akoita/resonate/issues/932): normal authenticated
activity, BigQuery-backed dashboard metadata, freshness, and matching totals.
