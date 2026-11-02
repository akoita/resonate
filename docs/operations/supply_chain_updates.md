# Supply-Chain Input Updates

Resonate reviews executable build inputs through ordinary pull requests. The
readable version/tag and immutable commit or digest must move together; do not
update a comment while retaining an old commit, or replace a digest without
reviewing the corresponding release.

## Dependabot update cadence and grouping

Routine version updates, including major, minor, and patch releases, arrive as
one monthly cross-ecosystem routine pull request across the configured package
ecosystems. Security updates remain immediate and event-driven, with one
grouped security pull request per affected ecosystem. Do not merge small,
superseded security pull requests individually.

Do not run a full CI/build for each dependency in a routine batch. Review and
consolidate the complete batch first, then run one full validation. Review the
lifecycle-policy tuple whenever grouped lockfile changes update a package with
an install script.

The `Dependency Train` workflow automates that consolidation. It runs from the
default branch, collects same-repository pull requests authored by
`dependabot[bot]`, and rebuilds the review-only
`automation/dependency-train` branch. Ordinary source pull requests keep the
deterministic supply-chain baseline but skip the expensive CI, advisory scan,
and formal-verification jobs; those jobs run once on the train pull request.
The workflow never merges a source pull request. Each run closes, with an
explanatory comment, the source pull requests whose head merged into `main`
would change nothing, because their update is already on `main`. When a train
pull request merges, a push-triggered close-only run closes the superseded
sources right away without building a new train; Dependabot opens a new pull
request if a newer version is released.

Major upgrades and changes to workflows, containers, contracts, deployment
configuration, or executable scripts stay outside the automatic train and are
listed as requiring individual review. Pull requests with pending or failed
checks and changes that conflict with another selected update are also listed
rather than forced into the train. Use the workflow's manual trigger when a
reviewed batch should be refreshed before its weekly schedule.

### Dependency Train authentication

The workflow publishes with a dedicated GitHub App installation token rather
than the repository's default `GITHUB_TOKEN`. The app must be installed only on
this repository and have only `contents: write` and `pull requests: write`
repository permissions. It needs no account permissions. This scope lets the
workflow update `automation/dependency-train` and create or update its review
pull request; it cannot administer the repository, manage secrets, or operate
on another repository.

Repository secrets `DEPENDENCY_TRAIN_APP_ID` and
`DEPENDENCY_TRAIN_APP_PRIVATE_KEY` supply the app credentials. The workflow
mints a short-lived installation token for each run and does not persist it in
the checkout. Keep the repository-wide **Allow GitHub Actions to create and
approve pull requests** setting disabled: the app-authored review pull request
triggers CI without widening every workflow's default token.

Rotate the app private key on the owner's normal credential-rotation schedule
and immediately after suspected disclosure. Install the replacement secret
before revoking the prior key, then run Dependency Train manually and verify
that it updates the review branch and opens or refreshes the CI-bearing pull
request. Missing or invalid app credentials fail the rebuild visibly; the
scheduled-failure reporter then records the failure without receiving the app
token.

For production Node.js images, select a supported LTS line rather than blindly
accepting Dependabot's newest major tag. Digest-pin the reviewed multi-platform
manifest and validate the resulting image reference with the repository's
Docker base-image check.

## Security alert triage

The repository's Security tab is the single queue for Dependabot and code
scanning alerts. Every open alert must be in one of three states: a fix is in a
pull request, a fix is waiting on an upstream release or the release-age
cutoff, or the alert is dismissed with a written reason.

Target times run from when the alert opens:

| Severity | Runtime dependency or code finding | Development-only dependency |
| --- | --- | --- |
| Critical | Fix or mitigate within 2 days | 7 days |
| High | 7 days | 30 days |
| Moderate | 30 days | Next monthly routine batch |
| Low | Next monthly routine batch | Next monthly routine batch, or dismiss |

Triage order:

1. Check reachability. A package that only runs in tests, linting, or desktop
   packaging cannot be reached by a request to a deployed service. Record that
   in the dismissal reason rather than silently ignoring the alert.
2. Prefer a lockfile-only fix inside the existing semver range
   (`npm update <package> --package-lock-only --ignore-scripts` in the affected
   project). Do not use `npm audit fix --force`; it proposes major upgrades or
   downgrades of unrelated packages.
3. Respect the npm `min-release-age=7` cutoff. A fix newer than seven days
   waits for the cutoff unless the alert is critical and reachable; record that
   urgent exception in the pull request.
4. When no fix exists, or the fix needs an upstream major release, dismiss as
   **Risk is tolerable** or **Vulnerable code not actually used** with the
   reason and a revisit condition, or keep the alert open with a linked issue.
   Use **Inaccurate** only for a wrong advisory match.
5. Fixes for payment, custody, authentication, and contract code (for example
   `@x402/*`, wallet, and signing libraries) never ride in a bulk lockfile
   refresh. They get their own pull request and the full validation ladder.

Three checkpoints keep the queue small:

- **Every pull request.** CodeQL analyzes the change, and the `Dependency
  Review` job in `security.yml` fails when the PR adds or changes a dependency
  with a high or critical advisory. Both block merge only when the `main`
  ruleset marks them required (code scanning: "Require code scanning results",
  High or higher).
- **Every week.** Advisories published against code already on `main` arrive
  as Dependabot alerts and grouped security PRs. Review the Security tab
  alongside the Monday Dependency Train and apply the targets above.
- **Every release.** `Software Release` runs
  `scripts/check-release-advisories.mjs`, which fails on any high or critical
  advisory in the production dependencies of `backend`, `web`, or `desktop`
  unless `scripts/release-advisory-exceptions.json` holds a matching exception
  with a reason, a tracking note, and an expiry date. Expired exceptions fail;
  unused ones produce a warning so they get removed.

Code scanning alerts follow the same table. Fix the finding, or dismiss it as
**False positive** or **Used in tests** with the reasoning in the dismissal
comment, so the next scan does not reopen the discussion.

## GitHub Actions

1. Wait at least seven days after a release unless the PR documents an urgent
   security exception.
2. Resolve the release tag in the publisher's official repository and record
   the final 40-character commit (dereference annotated tags).
3. Review publisher continuity, release notes, Action metadata/runtime changes,
   permissions, inputs, and the source diff from the current commit.
4. Update every `uses:` reference and retain the precise version comment:

   ```yaml
   uses: actions/checkout@<40-character-commit> # vX.Y.Z
   ```

5. Run `actionlint`, `zizmor`, the immutable-reference scan, and the
   revision-bound ABOM job. A tag, branch, shortened SHA, missing annotation, or
   unexpected new publisher is a review failure.

## Docker bases and workflow service images

Resolve the multi-platform manifest digest for the exact readable tag used by
the file:

```bash
docker buildx imagetools inspect node:20-slim
```

Review the upstream image release/base change and use the top-level `Digest`,
not a single-platform child manifest, unless the build is deliberately
single-platform and documents that choice. Keep the tag plus digest:

```dockerfile
FROM node:20-slim@sha256:<64-lowercase-hex>
```

Then run:

```bash
node scripts/check-docker-base-digests.mjs
docker build -f backend/Dockerfile backend
docker build -f web/Dockerfile web
```

Build the affected worker image as well. Re-run platform-specific Python lock
generation inside the new base whenever its Python, CUDA, Torch, OS, or ABI
surface changed.

## Contract submodules

The root gitlinks under `contracts/lib/` are the single source of truth for
every Foundry dependency pin, and `.gitmodules` for every repository URL.
`contracts/scripts/install-deps.sh` reads both, so a Dependabot `gitsubmodule`
bump is exactly the commit CI builds and tests. After `install-deps.sh`,
`git status` must show no modified submodules.

- `contracts/lib/account-abstraction` stays on v0.7.0 while the application
  profile targets EntryPoint v0.7. Dependabot ignores that submodule, and
  `install-deps.sh` fails if its gitlink names any other commit.
- An OpenZeppelin bump (`openzeppelin-contracts` or
  `openzeppelin-contracts-upgradeable`) runs the full contract test ladder and
  `contracts/scripts/check-storage-layout.sh`: a storage-layout or behaviour
  change in the upgradeable library affects the UUPS proxies.
- Update `contracts/foundry.lock` together with any gitlink you move.

## npm lifecycle and Python lock changes

- Use the hardened npm installer. A new `hasInstallScript` tuple fails until it
  has an exact path/version, `execute` or `deny` disposition, rationale, and
  focused platform coverage in `scripts/npm-lifecycle-policy.json`.
- Keep `ignore-scripts=true`; never bypass it in a generic `npm ci` command.
- Regenerate Python locks from their `.in` source using the documented worker
  base/platform command. Review every changed version and hash, then build and
  smoke-test that exact image.
- Regenerate per-image SBOMs from the final `@sha256` image; a source-directory
  SBOM does not replace release artifact evidence.

## Release evidence

Every accepted update must produce a validated T4 profile, revision-bound ABOM,
per-image CycloneDX SBOM, exact-identity signature plus SBOM/build-attestation
verification, versioned digest deploy manifest, and private attested-source/
declared/registry/live digest reconciliation. Follow
[supply-chain incident response](./supply_chain_incident_response.md) when any
identity or digest differs from the reviewed input.
