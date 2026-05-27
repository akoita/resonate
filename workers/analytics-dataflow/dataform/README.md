# Agent Taste Dataform Workflow

This directory is a Dataform-ready template for orchestrating Agent Taste
Intelligence materialization in BigQuery. It mirrors the manual SQL runner in
`../run-agent-taste-materialization.sh`, but splits the work into dependency
aware actions and assertions that can be scheduled by a Dataform workflow
configuration.

The template is intentionally kept beside the Dataflow worker because Dataflow
owns the streaming `events_clean` input and Dataform owns the post-Dataflow
derived marts. The GCP Dataform repository can either mirror this directory or
import these files during the `resonate-iac` deployment workflow.

## Actions

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

Copy `workflow_settings.yaml.example` to the root of the managed Dataform
repository and replace every `YOUR_*` placeholder in release configuration, not
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

## Scheduling Target

The production target is:

```text
Cloud Scheduler
  -> Workflows
  -> Dataform workflow invocation tagged agent_taste
  -> Dataform assertions
  -> Cloud Logging / Monitoring alert on failed invocation
```

Recommended cadence:

| Environment | Cadence | Notes |
| --- | --- | --- |
| staging | hourly | Cheap confidence that instrumentation is flowing. |
| production v1 | every 15-60 minutes | Tune after observing BigQuery cost and recommendation freshness. |
| BQML evaluation | daily | Offline quality gate; never promoted automatically without review. |

Keep the manual runner for backfills, incident recovery, and local dry-runs:

```bash
cd workers/analytics-dataflow
AGENT_TASTE_MATERIALIZATION_PROJECT_ID="$GCP_PROJECT_ID" \
AGENT_TASTE_BIGQUERY_DATASET="$ANALYTICS_BIGQUERY_DATASET" \
./run-agent-taste-materialization.sh --dry-run --verify
```
