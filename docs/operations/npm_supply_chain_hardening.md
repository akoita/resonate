# npm Supply-Chain Hardening

## Decision

Resonate stays on npm for now and hardens the existing package-lock workflow
instead of migrating to pnpm in this issue.

The repo has six independent npm projects (`/`, `backend/`, `web/`, `desktop/`,
`smoke-test/`, and `examples/mcp-client/`) with separate lockfiles and distinct
build or example roles. Moving everything
to pnpm would be a larger migration with peer-dependency and Docker blast
radius, especially because the web workspace still requires legacy peer
resolution. npm 11 now provides the key low-disruption control needed for the
recent maintainer-compromise threat model: `min-release-age`.

This decision can be revisited once the web peer-dependency graph is ready for
strict installs.

## Enabled Protections

- npm is pinned to `11.14.1` through `packageManager` metadata and CI/Docker
  setup.
- Node must be `>=20.19.0` and npm must be `>=11.10.0`; `engine-strict=true`
  makes incompatible local installs fail early.
- `.npmrc` enables `min-release-age=7`, so npm only selects package versions
  that are at least seven days old.
- Every project sets `ignore-scripts=true`. CI installs through
  `scripts/hardened-npm-install.mjs`: it first runs a frozen, script-disabled
  `npm ci`, then rebuilds only exact path/version tuples approved in
  `scripts/npm-lifecycle-policy.json`. Docker builds apply the same explicit
  policy within their restricted build contexts.
- CI runs `npm run security:lock-sources` across all six lockfiles to reject entries that
  resolve outside the public npm registry or local file references.
- CI runs `npm run security:npm-lifecycles` to fail on every new, removed, or
  changed install-script tuple until its `execute` or `deny` decision and
  rationale have been reviewed. The root Husky `prepare` hook is a separately
  approved first-party lifecycle and is never an implicit side effect of install.
- Backend Docker runtime no longer uses `npx` to fetch Prisma at startup; the
  Prisma CLI is installed from the committed backend lockfile and executed from
  `node_modules`.

## Why Not pnpm Yet

pnpm remains a good future candidate because it can block unapproved dependency
build scripts and prevent exotic transitive dependencies. Those protections are
stronger than npm's current lifecycle-script controls.

For this repo, however, an immediate pnpm migration would require changing CI
caches, Dockerfiles, local commands, lockfile shape, and the web peer-dependency
install behavior in one security PR. That increases regression risk without
being necessary to enable the release-age defense today.

## Working With New Dependencies

Change dependencies from the relevant project directory with lifecycle scripts
disabled, then review the lockfile and lifecycle-policy delta:

```bash
npm install --ignore-scripts <package>
cd /path/to/resonate
npm run security:lock-sources
npm run security:npm-lifecycles
```

If a new exact package path/version reports an install script, add a reviewed
entry to `scripts/npm-lifecycle-policy.json`. Prefer `deny`; approve `execute`
only when the build is required, document why, and add focused platform
coverage. Do not run a generic install with scripts enabled.

If a package version was published less than seven days ago, npm will fail the
install. Prefer waiting for the release-age window to pass. For an urgent
security fix, document the reason in the PR and temporarily override the config
for that one command:

```bash
npm_config_min_release_age=0 npm install --ignore-scripts <package>
```

Do not commit lockfile entries that resolve from git, tarball URLs, or private
registries unless the source has been reviewed and the lockfile-source scanner
is intentionally updated.

## Verification Commands

```bash
npm run security:lock-sources
npm run security:npm-lifecycles
npm run test:security:npm-lifecycles
node scripts/hardened-npm-install.mjs --project backend && npm --prefix backend run lint
node scripts/hardened-npm-install.mjs --project web -- --legacy-peer-deps && npm --prefix web run lint
```

Registry signature checks are useful during dependency-review work:

```bash
cd backend && npm audit signatures
cd web && npm audit signatures
```

They are not yet enforced in CI because npm ecosystem signature coverage is
still uneven.

For containment, evidence preservation, credential rotation, and recovery from
a malicious or confused dependency, follow the
[supply-chain incident-response playbook](./supply_chain_incident_response.md).
For reviewed version and digest refreshes, follow the
[supply-chain input update procedure](./supply_chain_updates.md).
