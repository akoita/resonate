#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Run the Agent Taste Intelligence BigQuery materialization.

Usage:
  run-agent-taste-materialization.sh [--dry-run] [--verify]

Options:
  --dry-run   Ask BigQuery to validate query syntax and referenced tables.
  --verify    Run freshness and coverage queries after the materialization.
  --help      Show this help text.

Environment:
  AGENT_TASTE_MATERIALIZATION_PROJECT_ID  BigQuery project for materialization.
  AGENT_TASTE_BIGQUERY_PROJECT_ID         Backend taste-score project fallback.
  ANALYTICS_BIGQUERY_PROJECT_ID           Analytics reporting project fallback.
  ANALYTICS_WAREHOUSE_PROJECT_ID          Analytics warehouse project fallback.
  GCP_PROJECT_ID                          GCP project fallback.

  AGENT_TASTE_BIGQUERY_DATASET            Dataset for taste-score tables.
  ANALYTICS_BIGQUERY_DATASET              Analytics reporting dataset fallback.
  ANALYTICS_WAREHOUSE_DATASET_PREFIX      Analytics warehouse dataset fallback.

  AGENT_TASTE_BIGQUERY_CLEAN_TABLE        Clean analytics events table. Defaults to events_clean.
  AGENT_TASTE_BIGQUERY_TRAINING_TABLE     Training signal table. Defaults to user_track_signal_training.
  AGENT_TASTE_BIGQUERY_SCORES_TABLE       Serving score table. Defaults to user_track_recommendation_scores.
  AGENT_TASTE_MATERIALIZATION_VERSION     Model/materialization version label.
  BIGQUERY_LOCATION                       Optional bq --location value.
USAGE
}

DRY_RUN=false
VERIFY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --verify)
      VERIFY=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="${SCRIPT_DIR}/sql"
BASELINE_SQL="${SQL_DIR}/agent_taste_intelligence_baseline.sql"
VERIFY_SQL="${SQL_DIR}/agent_taste_intelligence_verification.sql"

resolve_project() {
  if [[ -n "${AGENT_TASTE_MATERIALIZATION_PROJECT_ID:-}" ]]; then
    printf '%s\n' "${AGENT_TASTE_MATERIALIZATION_PROJECT_ID}"
  elif [[ -n "${AGENT_TASTE_BIGQUERY_PROJECT_ID:-}" ]]; then
    printf '%s\n' "${AGENT_TASTE_BIGQUERY_PROJECT_ID}"
  elif [[ -n "${ANALYTICS_BIGQUERY_PROJECT_ID:-}" ]]; then
    printf '%s\n' "${ANALYTICS_BIGQUERY_PROJECT_ID}"
  elif [[ -n "${ANALYTICS_WAREHOUSE_PROJECT_ID:-}" ]]; then
    printf '%s\n' "${ANALYTICS_WAREHOUSE_PROJECT_ID}"
  elif [[ -n "${GCP_PROJECT_ID:-}" ]]; then
    printf '%s\n' "${GCP_PROJECT_ID}"
  elif command -v gcloud >/dev/null 2>&1; then
    gcloud config get-value project 2>/dev/null || true
  fi
}

TARGET_PROJECT="$(resolve_project)"
TARGET_DATASET="${AGENT_TASTE_BIGQUERY_DATASET:-${ANALYTICS_BIGQUERY_DATASET:-${ANALYTICS_WAREHOUSE_DATASET_PREFIX:-}}}"
CLEAN_TABLE="${AGENT_TASTE_BIGQUERY_CLEAN_TABLE:-events_clean}"
SCORES_TABLE="${AGENT_TASTE_BIGQUERY_SCORES_TABLE:-user_track_recommendation_scores}"
TRAINING_TABLE="${AGENT_TASTE_BIGQUERY_TRAINING_TABLE:-user_track_signal_training}"
MODEL_VERSION="${AGENT_TASTE_MATERIALIZATION_VERSION:-baseline-weighted-signals/v2}"

if [[ -z "${TARGET_PROJECT}" ]]; then
  echo "Missing BigQuery project. Set AGENT_TASTE_MATERIALIZATION_PROJECT_ID or one of the documented project fallbacks." >&2
  exit 2
fi

if [[ -z "${TARGET_DATASET}" ]]; then
  echo "Missing BigQuery dataset. Set AGENT_TASTE_BIGQUERY_DATASET, ANALYTICS_BIGQUERY_DATASET, or ANALYTICS_WAREHOUSE_DATASET_PREFIX." >&2
  exit 2
fi

if ! command -v bq >/dev/null 2>&1; then
  echo "Missing bq CLI. Install Google Cloud SDK or run this script in an environment that provides bq." >&2
  exit 127
fi

BQ_ARGS=(query --use_legacy_sql=false)
if [[ -n "${BIGQUERY_LOCATION:-}" ]]; then
  BQ_ARGS+=(--location "${BIGQUERY_LOCATION}")
fi
if [[ "${DRY_RUN}" == "true" ]]; then
  BQ_ARGS+=(--dry_run)
fi

BASELINE_PARAMS=(
  "--parameter=target_project:STRING:${TARGET_PROJECT}"
  "--parameter=target_dataset:STRING:${TARGET_DATASET}"
  "--parameter=clean_table:STRING:${CLEAN_TABLE}"
  "--parameter=training_table:STRING:${TRAINING_TABLE}"
  "--parameter=scores_table:STRING:${SCORES_TABLE}"
  "--parameter=model_version:STRING:${MODEL_VERSION}"
)

VERIFY_PARAMS=(
  "--parameter=target_project:STRING:${TARGET_PROJECT}"
  "--parameter=target_dataset:STRING:${TARGET_DATASET}"
  "--parameter=scores_table:STRING:${SCORES_TABLE}"
  "--parameter=training_table:STRING:${TRAINING_TABLE}"
)

echo "Materializing Agent Taste Intelligence scores into ${TARGET_PROJECT}.${TARGET_DATASET}.${SCORES_TABLE}"
bq "${BQ_ARGS[@]}" "${BASELINE_PARAMS[@]}" < "${BASELINE_SQL}"

if [[ "${VERIFY}" == "true" ]]; then
  echo "Running Agent Taste Intelligence verification queries"
  bq "${BQ_ARGS[@]}" "${VERIFY_PARAMS[@]}" < "${VERIFY_SQL}"
fi
