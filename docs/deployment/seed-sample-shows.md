# Seeding / refreshing the sample Show campaigns

The Shows surface ships four researched, clearly-fictional **sample campaigns**
(SennaRin / Paris, Felicia Farerre / Dublin, Leona Lewis / Lagos, Aya Nakamura /
Montréal). On a deployed environment these are written into the database and
their artist / hero / gallery images are uploaded to the configured
`StorageProvider` (GCS on dev/staging/prod) by the **`fixtures:shows` seed**.

## Why a deploy alone is not enough

The home **"Upcoming Live Events"** cards and the Shows detail pages render the
**backend-seeded** campaigns. The backend serves each hero/gallery image from
storage (via `…/shows/campaigns/<id>/visuals/<slot>`), and **those stored images
only change when the seed runs again.**

Deploying new backend *code* does **not** by itself re-upload them. So when a Show
fixture changes — a new hero photo, a swapped portrait, an added gallery image, an
edited bio — the new bytes live in the repo and the static `web/public/shows/*`
fallback, but the stored images only refresh when the seed runs.

The `resonate-iac` deploy pipeline now runs that seed automatically after each
non-prod backend rollout (see [Wiring it into the deploy pipeline](#wiring-it-into-the-deploy-pipeline)),
so in practice a fixture change goes live on the next backend deploy. The manual
steps below still apply when running outside that pipeline.

> Symptom (if the seed step was skipped or failed): you merged an image change,
> staging redeployed, hard-refresh shows no change. That means the seed has not
> been re-run, not that the deploy failed — re-run it as below.

## The seed is safe to re-run

`fixtures:shows` is **idempotent**: it upserts the four artists/campaigns and
**re-uploads + replaces only the fixture-owned tiers and visuals** each run. It
**refuses** to touch a shared environment (`dev`/`staging`/`test`/`prod`) unless
`ALLOW_SAMPLE_SHOW_FIXTURES=true` is set explicitly.

## Running it

### Local (or any context with DB + storage env)

```bash
make seed-shows
# = cd backend && ALLOW_SAMPLE_SHOW_FIXTURES=true npm run fixtures:shows
```

Requires `DATABASE_URL`, `STORAGE_PROVIDER`, and the matching storage
credentials/bucket env to point at the target environment. Add `-- --dry-run`
to validate the manifest without writing.

### Deployed environment — one-off Cloud Run Job (recommended)

Run the seed **inside the cluster** from the just-deployed backend image, so it
reuses the service's network, Cloud SQL connection, and storage credentials —
no need to expose the database to CI.

```bash
GCP_PROJECT=...               # target project
GCP_REGION=europe-west1
BACKEND_IMAGE=...             # the image deploy-backend just rolled out
SHOWS_SEED_JOB=resonate-shows-seed-<env>
SHOWS_SEED_SECRETS="DATABASE_URL=resonate-database-url:latest"
# optional: SHOWS_SEED_SA, SHOWS_SEED_ENV (e.g. GCS bucket vars),
#           SHOWS_SEED_VPC_CONNECTOR, SHOWS_SEED_CLOUDSQL_INSTANCE
make seed-shows-remote        # = ./scripts/deploy/seed-sample-shows.sh
```

The script ([`scripts/deploy/seed-sample-shows.sh`](../../scripts/deploy/seed-sample-shows.sh))
deploys/updates the Cloud Run Job to run `node dist/scripts/create_sample_show_campaigns.js`
with `ALLOW_SAMPLE_SHOW_FIXTURES=true`, then executes it and waits. Nothing is
hardcoded — every project/region/image/secret value comes from env.

This works because the backend production image now includes the compiled seed
(`dist/scripts/…`) and the fixture assets (`COPY fixtures ./fixtures` in
`backend/Dockerfile`).

## Wiring it into the deploy pipeline

**Done — this runs automatically.** App deployment lives in **`resonate-iac`**,
whose `deploy-services.yml` workflow now re-seeds after every backend rollout:

```
Terraform apply (backend rollout)  →  re-seed resonate-shows-seed-<env>  →  validate
```

The post-apply step points the env's `resonate-shows-seed-<env>` Cloud Run Job at
the just-deployed backend image and runs it with `--wait`. It only runs on
**non-prod** envs, only when **backend** is in the deployed services, and skips
cleanly when no seed job exists. Because the seed is idempotent, running it on
every deploy is safe; it only does real work when an asset or record actually
changed.

So a fixture/image change now goes live on the next backend deploy — no manual
seed needed. The manual commands above remain useful for ad-hoc refreshes,
provisioning the job on a brand-new env, or running outside a deploy.

## Verifying

After the job completes, confirm a refreshed image is being served:

```bash
# The web fallback (always current with the deploy):
curl -sI https://<env>/shows/felicia-farerre-dublin-hero.jpg
# The backend-served, seeded image used by the live cards — re-fetch and eyeball
# it, or compare its bytes to backend/fixtures/show-campaigns/assets/<file>.
```

Then hard-refresh the home page; the "Upcoming Live Events" cards should show the
new imagery.

## Related

- Env vars: `ALLOW_SAMPLE_SHOW_FIXTURES`, `SAMPLE_SHOWS_CHAIN_ID`,
  `SAMPLE_SHOWS_ASSET_DIR` — see [`environment.md`](./environment.md).
- Fixture manifest + assets: `backend/src/fixtures/show_campaigns.ts`,
  `backend/fixtures/show-campaigns/`.
- Feature page: [`docs/features/resonate_shows.md`](../features/resonate_shows.md).
