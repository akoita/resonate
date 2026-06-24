#!/usr/bin/env bash
#
# seed-sample-shows.sh — refresh the sample Show campaigns on a deployed
# environment by running the idempotent `fixtures:shows` seed as a one-off
# Cloud Run Job, built from the already-deployed backend image.
#
# WHY: the home "Upcoming Live Events" cards and the Shows detail pages render
# the backend-seeded campaigns, whose hero/gallery images are served from
# storage. Those stored images only change when the seed runs again — deploying
# new backend *code* does not re-upload them. Run this AFTER `deploy-backend`
# whenever the Show fixtures (artist photos, bios, hero/gallery assets) change.
#
# The seed is idempotent: it upserts the four sample artists/campaigns and
# re-uploads + replaces only the fixture-owned tiers and visuals.
#
# Nothing here is hardcoded — every environment-specific value comes from env.
#
# Required env:
#   GCP_PROJECT          GCP project id of the target environment
#   GCP_REGION           Cloud Run region (e.g. europe-west1)
#   BACKEND_IMAGE        Fully-qualified image the backend was just deployed from
#                        (e.g. europe-west1-docker.pkg.dev/$PROJECT/app/backend@sha256:...)
#   SHOWS_SEED_JOB       Cloud Run Job name (e.g. resonate-shows-seed-staging)
#   SHOWS_SEED_SECRETS   gcloud --set-secrets spec giving the job the same DB +
#                        storage secrets the backend uses, e.g.
#                        "DATABASE_URL=resonate-database-url:latest"
#
# Optional env:
#   SHOWS_SEED_SA        Runtime service account (needs Cloud SQL + storage write).
#                        Defaults to the project's Compute default SA.
#   SHOWS_SEED_ENV       Extra comma-separated KEY=VALUE runtime vars the seed
#                        needs (e.g. the storage bucket vars: GCS_STEMS_BUCKET=...).
#   SHOWS_SEED_VPC_CONNECTOR     Serverless VPC connector (if the DB needs it).
#   SHOWS_SEED_CLOUDSQL_INSTANCE Cloud SQL instance connection name to attach.
#   STORAGE_PROVIDER             Defaults to "gcs".
#   SAMPLE_SHOWS_CHAIN_ID        Passed through if set.
#
# Usage:
#   GCP_PROJECT=... GCP_REGION=... BACKEND_IMAGE=... SHOWS_SEED_JOB=... \
#   SHOWS_SEED_SECRETS="DATABASE_URL=resonate-database-url:latest" \
#   scripts/deploy/seed-sample-shows.sh
#
set -euo pipefail

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "error: \$$name is required (see header of $0)" >&2
    exit 2
  fi
}
require GCP_PROJECT
require GCP_REGION
require BACKEND_IMAGE
require SHOWS_SEED_JOB
require SHOWS_SEED_SECRETS

# Runtime env for the seed: the safety flag is always set here so the job can
# write to the shared environment; everything else is supplied by the caller.
env_vars="ALLOW_SAMPLE_SHOW_FIXTURES=true,STORAGE_PROVIDER=${STORAGE_PROVIDER:-gcs}"
[ -n "${SAMPLE_SHOWS_CHAIN_ID:-}" ] && env_vars="${env_vars},SAMPLE_SHOWS_CHAIN_ID=${SAMPLE_SHOWS_CHAIN_ID}"
[ -n "${SHOWS_SEED_ENV:-}" ] && env_vars="${env_vars},${SHOWS_SEED_ENV}"

extra_args=()
[ -n "${SHOWS_SEED_SA:-}" ] && extra_args+=(--service-account "${SHOWS_SEED_SA}")
[ -n "${SHOWS_SEED_VPC_CONNECTOR:-}" ] && extra_args+=(--vpc-connector "${SHOWS_SEED_VPC_CONNECTOR}")
[ -n "${SHOWS_SEED_CLOUDSQL_INSTANCE:-}" ] && extra_args+=(--set-cloudsql-instances "${SHOWS_SEED_CLOUDSQL_INSTANCE}")

echo "==> Configuring Cloud Run Job '${SHOWS_SEED_JOB}'"
echo "    project=${GCP_PROJECT} region=${GCP_REGION}"
echo "    image=${BACKEND_IMAGE}"
gcloud run jobs deploy "${SHOWS_SEED_JOB}" \
  --project "${GCP_PROJECT}" \
  --region "${GCP_REGION}" \
  --image "${BACKEND_IMAGE}" \
  --command node \
  --args dist/scripts/create_sample_show_campaigns.js \
  --set-env-vars "${env_vars}" \
  --set-secrets "${SHOWS_SEED_SECRETS}" \
  --max-retries 1 \
  --task-timeout 600s \
  "${extra_args[@]}"

echo "==> Executing seed job (waiting for completion)"
gcloud run jobs execute "${SHOWS_SEED_JOB}" \
  --project "${GCP_PROJECT}" \
  --region "${GCP_REGION}" \
  --wait

echo "==> Sample Show campaigns refreshed on ${GCP_PROJECT}/${GCP_REGION}."
