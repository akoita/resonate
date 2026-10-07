# Analytics Dataform workflows

This directory contains Dataform templates for Agent Taste Intelligence and
discovery popularity/engagement materialization in BigQuery. The Agent Taste actions mirror the manual SQL runner in
`../run-agent-taste-materialization.sh`. Each workflow splits materialization
into dependent actions and assertions.

The template is intentionally kept beside the Dataflow worker because Dataflow
owns the streaming `events_clean` input and Dataform owns the post-Dataflow
derived marts. A managed GCP Dataform repository consumes the generated
`dataform/main` branch described below.

## Agent Taste actions

| Action | Type | Purpose |
| --- | --- | --- |
| `track_intelligence_features` | table | Track-level interaction features from `events_clean`. |
| `user_track_signal_training` | table | Signed implicit-feedback rows with session-intent context. |
| `user_track_recommendation_scores` | table | Serving contract consumed by `AgentBigQueryTasteSignalService`. |
| `agent_taste_materialization_report` | view | Freshness, coverage, and signal-mix inspection view. |
| `assert_agent_taste_required_fields` | assertion | Fails if required serving columns are null. |
| `assert_agent_taste_score_bounds` | assertion | Fails if score, confidence, or rank values are outside the serving contract. |
| `assert_agent_taste_freshness` | assertion | Fails when the score table is empty or older than the configured freshness window. |

## Configuration

The generated `dataform/main` branch (see below) already carries a root
`workflow_settings.yaml` derived from `workflow_settings.yaml.example`; replace
every placeholder in release configuration, not
in source code. The important compilation variables are:

| Variable | Purpose |
| --- | --- |
| `analytics_project` | BigQuery project containing `events_clean`. |
| `analytics_dataset` | BigQuery dataset containing `events_clean` and Agent Taste outputs. |
| `clean_table` | Clean analytics events table. Defaults to `events_clean` in the template. |
| `training_table` | Training signal table. Defaults to `user_track_signal_training`. |
| `scores_table` | Serving score table. Defaults to `user_track_recommendation_scores`. |
| `model_version` | Version label written to serving rows. |
| `freshness_hours` | Maximum acceptable score age for assertions. |

## Generated root-level branch (`dataform/main`)

Managed Dataform compiles a git repository whose root holds
`workflow_settings.yaml`, but this project lives in a subdirectory of the
monorepo and only ships `workflow_settings.yaml.example` (deployment values are
never committed). The branch `dataform/main` solves that mismatch:

- `.github/workflows/publish-dataform-root-branch.yml` runs on pushes to `main`
  that touch this directory, `../dataform-cli/` or the build scripts, and on
  manual dispatch. It builds the tree, compiles it with the pinned CLI, and only
  then force-pushes it as a single orphan commit.
- The generated tree contains `definitions/`, `includes/`, this README, a root
  `workflow_settings.yaml`, and `GENERATED_FROM` (source commit and path). The
  settings file is derived from the example with inert placeholder values
  (`resonate-placeholder-project`, `resonate_placeholder`, `US`) and keeps the
  vars and `dataformCoreVersion`.
- The branch is overwritten on every publish. Never edit it and never merge it
  or open pull requests against it; change the sources in this directory
  instead.
- Deployments override every placeholder through Dataform release-config
  compilation overrides and vars (`defaultProject`, `defaultDataset`,
  `defaultLocation`, `defaultAssertionDataset` and the `analytics_*` vars), so
  no real project or dataset ID is ever stored in git. The overrides and the
  repository connection are configured in `resonate-iac`.
- `dataformCoreVersion` in `workflow_settings.yaml.example` is the single source
  of the `@dataform/core` version. `../dataform-cli/package.json` pins the
  matching `@dataform/cli`; keep them identical (a unit test enforces it). Both
  are bumped together.

Run the same build and compile check locally (requires network; the CLI installs
`@dataform/core` for the compile and the check does not modify the tree):

```bash
tree="$(mktemp -d)/dataform-root"   # must be empty or non-existent
node scripts/hardened-npm-install.mjs --project workers/analytics-dataflow/dataform-cli
python3 workers/analytics-dataflow/scripts/build_dataform_root_tree.py \
  --source workers/analytics-dataflow/dataform \
  --out "$tree" \
  --source-commit "$(git rev-parse HEAD)"
bash workers/analytics-dataflow/scripts/check_dataform_root_tree.sh "$tree"
(cd workers/analytics-dataflow && python3 -m unittest test_dataform_root_tree)
```

## Scheduling and execution

Invoke materialization after warehouse inputs are ready and require its
assertions before exporting serving data. Environment-specific schedules,
workload credentials, workflow wiring and alerts belong in `resonate-iac`.
Discovery popularity deployment is tracked in
[resonate-iac#263](https://github.com/akoita/resonate-iac/issues/263).

Keep the manual runner for backfills, incident recovery, and local dry-runs:

```bash
cd workers/analytics-dataflow
AGENT_TASTE_MATERIALIZATION_PROJECT_ID="$GCP_PROJECT_ID" \
AGENT_TASTE_BIGQUERY_DATASET="$ANALYTICS_BIGQUERY_DATASET" \
./run-agent-taste-materialization.sh --dry-run --verify
```

## Discovery popularity (#1450)

Actions tagged `discovery_popularity` build a trusted recent-event view,
`track_popularity` and `artist_engagement`, a freshness/row-count sentinel,
and serving-contract assertions.
The marts use 24h/7d/30d windows, genre and overall rows, completion-weighted
plays, saves, settled purchases and distinct listener audiences. Unknown
eligibility metadata, fully AI-generated tracks and self-engagement fail closed.

Compilation uses the shared `analytics_project`, `analytics_dataset` and
`clean_table` variables plus:

| Variable | Default / purpose |
| --- | --- |
| `raw_table` | `events_raw`, for governed envelope consent basis. |
| `discovery_popularity_events_table` | `discovery_popularity_eligible_events`. |
| `track_popularity_table` | `track_popularity`. |
| `artist_engagement_table` | `artist_engagement`. |
| `discovery_popularity_snapshot_table` | `discovery_popularity_snapshot`; built after both marts, including empty results. |
| `discovery_snapshot_max_age_minutes` | `120`; match backend `DISCOVERY_POPULARITY_SNAPSHOT_MAX_AGE_MINUTES`. |
| `discovery_min_audience` | `3`; match backend `DISCOVERY_MIN_AUDIENCE`. |
| `discovery_save_score_weight` | `2`; match the local scoring contract. |
| `discovery_purchase_score_weight` | `5`; match the local scoring contract. |

Check assertions before exporting. The scheduled application exporter reads
only these precomputed tables and atomically replaces Postgres snapshots,
then rotates Redis generation. Source partition verification, dry-run cost
bounds, cadence, credential grants and live acceptance belong in
[resonate-iac#263](https://github.com/akoita/resonate-iac/issues/263).
A recent-timestamp predicate alone does not prove physical partition pruning.
Dataform compilation checks the action graph; use BigQuery dry runs to validate
GoogleSQL syntax and estimate bytes. The `window` column keeps its shared name
and is backtick-quoted in SQL because it is a reserved keyword.

See [Discovery popularity and engagement](../../../docs/features/discovery_popularity.md)
for the serving contract, configuration and failure behavior.
