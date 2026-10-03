# Scene Scout city-card acceptance fixtures

Use this operator tool when a staging artist has no qualifying city-demand
card and cannot complete the card-to-Show-draft acceptance checks. It creates
clearly synthetic listening demand for an explicitly selected existing release,
then asks the normal Scene Scout service to produce the suggestion. It does not
lower privacy thresholds or change real users' analytics consent.

This is vision-neutral validation infrastructure supporting ADR-BM-6 Line 2,
Artist Pro phase 2, and its Line 1 Shows continuation. It changes no fees,
payouts, or discovery placement privileges.

## What this proves

Synthetic fixtures can make the actual artist dashboard serve a city card and
let an owner test editable prefill, saving, reopening, and source-release
persistence. They exercise the deployed aggregation and draft path, but do not
prove that real browser listening captures declared cities. Browser collection
of listening geography remains partial; see the
[geo analytics feature](../features/geo_analytics_demand_dimension.md).

Raw dashboard play counts are insufficient: Scene Scout also requires current
analytics consent, declared city geography, a qualifying release/track, enough
distinct listeners, and at least five signals. Activity by the artist's own
account is excluded. Creating more plays on that account cannot replace a
prepared acceptance case.

Unmet demand, first-listener placement and reception, access controls, real
consent withdrawal/erasure, warehouse processing, and scheduling need separate
acceptance evidence. Do not mark those checks complete from this fixture run.

## Prepare a reviewed staging execution

The application entry point is
`backend/dist/scripts/scene_scout_acceptance.js` after a backend build. Run it
inside an approved backend runtime with database connectivity and the existing
analytics identity salt injected through secret references. Do not copy secret
values into commands, logs, issue comments, or this repository.

The tool accepts only deployment labels recognized as staging in
`RESONATE_ENVIRONMENT_ID`, `DEPLOY_ENV`, or `APP_ENV`, including staging identity
suffixes. If multiple labels are set, each must identify staging. Missing,
unknown, and conflicting tier labels are rejected, including labels containing
both staging and production tokens. `NODE_ENV` is the image's build mode and
does not identify staging.
Mutation additionally requires the configured analytics identity salt and
`--confirm`. No application configuration variables or migrations are added.

Choose an existing artist with an account owner and a ready or published,
unwithdrawn release containing a track. The release must belong to that artist
and satisfy the Shows source-release credit rules for the intended Show artist.
The Show artist defaults to the analytics artist; use `--show-artist-id` for
a different canonical main/primary artist credited in the managed release.
Upload ownership alone is insufficient: an imported release may have ambiguous
performer credits. Resolve catalog identity through the normal operator review
workflow or choose a suitable dedicated release; do not change attribution just
to make a test pass.

Record the selected artist, release, run ID and coarse test city in private
acceptance tracking. Use a
dedicated staging release where possible: synthetic demand will be visible on
the artist's real staging dashboard until cleanup.

Deployment approval, immutable image selection, job identity, database and
network wiring, environment URLs, and execution evidence belong in
`resonate-iac#264`. This document describes the application procedure; it does
not authorize a rollout or a job execution. The standard sample Shows seed
creates campaign fixtures and cannot substitute for listening-demand fixtures.

## Preview, seed, and inspect

From the backend runtime's working directory, preview the selected target:

```sh
node dist/scripts/scene_scout_acceptance.js preview \
  --artist-id <artist-id> --release-id <release-id> \
  --run-id <acceptance-run-id> --city-slug paris --country-code FR
```

Preview validates the target and describes the fixture without creating users,
events, consent records, or snapshots. A run ID uses 1–24 lowercase letters,
digits, or hyphens, starting with a letter or digit. Keep all target arguments
for the following phases: they identify the same fixture namespace.

If the desired song is a track on an album, pass its exact `--track-id` as well
as the containing `--release-id`; otherwise the first ordered track is used.
Retain optional track and Show artist selectors unchanged for later phases.

Change `preview` to `seed` and add `--confirm` for the approved mutation. The
seed creates only its own marked synthetic listener accounts and current-policy
consent records, with a full play followed by a save for each listener in the
same declared city. It uses at least three listeners and respects the configured
audience floor, refusing unusually large fixture batches. It creates no wallets,
credentials, catalog releases, Show campaigns, payments, or pledges.

Seed refreshes the normal artist Scene Scout snapshots and verifies that the
selected release/city produces a **Draft a show** card. The output contains
aggregate evidence and the relative draft link, without listener identities or
secret values. Existing fixture rows cause seed to refuse rather than overwrite
them. A failed card verification is a blocker; do not substitute a manually
inserted aggregate or relax the thresholds.

Use `verify` with the same arguments and `--confirm` to refresh and check the
card again. This phase writes the same derived snapshots that an ordinary
dashboard read refreshes; it creates no additional listeners or events.

## Owner browser checks

1. Sign in to staging with the selected artist's existing account and open
   Artist Analytics. Find the city card for the selected release.
2. Select **Draft a show**. Confirm the suggested city and source release are
   filled in, and opening the editor creates no campaign.
3. Edit the city, save a draft, reopen it, and confirm its source release remains
   attached. Edit and save again, then check persistence again.
4. Where suitable artist choices are available, select an artist outside the
   release's main/primary credits and verify the editor clears the link.
5. Record pass/fail evidence privately, identifying the data as synthetic.
   Use drafts only; no launch, pledge, payment, or publication is needed.

Withdrawn/unavailable release rejection and editing legacy drafts need their
own appropriate cases. The tool does not withdraw or alter existing catalog
content to manufacture those cases.

## Cleanup and evidence limits

Run `cleanup` with the same target arguments and `--confirm`. Cleanup verifies
fixture ownership before deleting only the tool's events and synthetic users
and their consent records, then recomputes the artist's snapshots from remaining
eligible data. It preserves the existing artist, release, tracks, real consent,
and any drafts saved during acceptance. Cleanup covers application PostgreSQL
rows only. A staging exporter may already have copied synthetic events into a
warehouse; their markers identify them for the separately reviewed downstream
reconciliation tracked in `resonate-iac#263`. Do not claim warehouse cleanup
from this command's success. The operator decides whether to retain
or remove acceptance drafts through the normal Shows workflow.

Cleanup remains necessary after a failed seed verification. Retain the run's
target arguments so it can still remove its data if the release later becomes
unavailable. A namespace collision or unexpected marker causes cleanup to
refuse; inspect the conflict rather than broadening deletion criteria.

Record the application source and image, selected target, aggregate verification,
owner browser results, and cleanup outcome in private tracking. The public
application issue should contain mechanisms and test status only. A synthetic
card and a successful draft save complete that acceptance slice, not the whole
Scene Scout milestone.
