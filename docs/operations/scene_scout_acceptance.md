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

The [scenario phases](#acceptance-scenarios) below add evidence for consent
withdrawal, account erasure, categorical unmet crate demand, and the artist
analytics authorization decision. First-listener placement and reception,
first-listener caps, browser consent UI, warehouse processing, and scheduling
still need separate acceptance evidence. Do not mark those checks complete from
this fixture run.

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

## Acceptance scenarios

These phases run the real application services against the run's synthetic
fixture users only; they insert no aggregates and relax no thresholds. They use
the same target arguments and staging, salt, and fixture-ownership checks as the
other phases, and their output is aggregate counts and pass/fail results only:
no user, actor, email, wallet, prompt, or secret values. `withdraw-consent`,
`erase-listener`, and `unmet-demand` require `--confirm`; `access-check` is
read-only and needs neither `--confirm` nor the salt (it still requires a
staging label).

Each of `withdraw-consent` and `erase-listener` consumes the seeded fixture: it
needs a freshly seeded, intact fixture whose city card is currently served, and
refuses otherwise (including a second attempt on the same fixture). Run
`cleanup`, then `seed` again, between scenarios. With a floor-sized fixture the
card and stored city snapshot disappear; with a larger audience the aggregate
must fall by exactly one listener.

| Phase | Action | Result |
| --- | --- | --- |
| `withdraw-consent` | Records `productAnalytics=false` for fixture listener 1 through `AnalyticsConsentService`, refreshes the artist snapshots, and compares served and stored aggregates with the pre-change values. | `contribution_removed`, or `blocked` with a reason. |
| `erase-listener` | Runs `PersonalDataErasureService.eraseAccount` for fixture listener 2, then compares as above and reports that listener's event count before and after. | `contribution_removed`, or `blocked` with a reason. |
| `unmet-demand` | Creates (or reuses) the audience-floor count of consenting fixture listeners, records one crate request each through `UnmetDemandService` requiring the first crate stem type the selected track really lacks (normally `vocals`); when the track has every stem type, it instead uses a categorical filter the track really fails (see below). Then it reads the artist aggregate. | `verified` with `gapKind`, the categorical `value`, the catalog action (`track` + `stem`, or `artist` + `bpm`/`key`/`energy`), requester and request counts, and privacy checks; or `blocked`. |
| `access-check` | Calls `AnalyticsAuthorizationService.assertCanReadArtistMetrics` with `{ userId, role }` request-user objects, as the JWT strategy shapes them. No token is minted. | Pass/fail per case: target artist owner allowed; a fixture non-artist listener forbidden; the `--show-artist-id` artist's owner forbidden (reported `skipped` when that owner is the target owner or absent). |

`unmet-demand` also checks that the stored observations contain only
categorical values (crate source, a one-way source digest, the target, the gap
kind, and its value) with no prompt or free text, and that the response exposes
no fixture user or actor identity.

A missing stem is the first choice and is a track-level gap. On a fully stemmed
track (every staging track), the phase falls back, in order, to a BPM, key, or
energy gap, using the track's measured features from its current `original` stem
as the crate pipeline reads them: a 10-BPM bin that excludes its tempo (for
example `180–189 BPM`), the Camelot key half way round the wheel from its key
(neither the same key nor a neighbour), or an energy band (`low` or `high`) that
excludes its energy. These describe artist or genre supply, so the observation
targets the artist (not the track) and counts only because the track fails
exactly that one filter and passes every other default filter. A kind is used
only when the pure crate filters and demand derivation yield exactly that
near-match for this track before anything is recorded. If the selected track is
not a clean, complete, playable catalog track, is fully AI-generated, or has every
stem type and no measured tempo, key, or energy, the phase is `blocked`; choose
another track rather than altering the catalog. It reuses an
existing seeded fixture's listeners when present, and otherwise creates
listeners without listening events (so `seed` for that run is then refused as a
collision).

`erase-listener` runs the production erasure path. Erasure rotates the fixture
account's id and deletes its events, so before erasing, the tool records two
marker events in the fixture's namespace (`erasure_started`, then
`erased_account` carrying the account's new random id; no actor or subject, and
no personal data). `cleanup` identifies the erased account only through those
validated markers, additionally requires it to be an erased account created
after the marker, and refuses (leaving rows in place) if a marker is missing,
tampered with, or names anything else. If the runtime is configured with a
BigQuery warehouse, erasure also propagates the deletion to it through the
normal governance path; a failed warehouse step aborts the erasure and leaves
the fixture intact for retry or cleanup. A staging exporter may have copied the
synthetic events before erasure, as for any fixture.

`cleanup` also removes the fixture's demand observations and any erased fixture
account (with its retained consent row), tolerates consent-withdrawn listeners,
and recomputes both the Scene Scout and unmet-demand snapshots from remaining
data. The `verify` phase and the scenario preconditions refuse a fixture that
has already run `withdraw-consent` or `erase-listener`.

Limits: these phases do not prove the browser consent UI, that the real
listener flow reaches the same services, first-listener placement caps, or
warehouse reconciliation. `access-check` exercises the authorization decision
with constructed request users, not a signed token through the HTTP stack, and
it does not replace testing as a real second artist in the browser (the web
analytics page always loads the signed-in user's own artist). Unauthorized
cross-artist access over HTTP and first-listener caps still need separate
evidence.

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
