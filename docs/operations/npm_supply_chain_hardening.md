# npm Supply-Chain Hardening

## Decision

Resonate stays on npm for now and hardens the existing package-lock workflow
instead of migrating to pnpm in this issue.

The repo already has three independent npm projects (`/`, `backend/`, and
`web/`) with separate lockfiles, Docker builds, and CI jobs. Moving everything
to pnpm would be a larger migration with peer-dependency and Docker blast
radius, especially because the web workspace still requires legacy peer
resolution. npm 11 now provides the key low-disruption control needed for the
recent maintainer-compromise threat model: `min-release-age`.

This decision can be revisited once the web peer-dependency graph is ready for
strict installs.

## Enabled Protections

- npm is pinned to `11.14.1` through `packageManager` metadata and CI/Docker
  setup.
- Node must be `>=20.17.0` and npm must be `>=11.10.0`; `engine-strict=true`
  makes incompatible local installs fail early.
- `.npmrc` enables `min-release-age=7`, so npm only selects package versions
  that are at least seven days old.
- CI and Docker continue to use frozen `npm ci` installs from committed
  lockfiles.
- CI runs `npm run security:lock-sources` to reject package-lock entries that
  resolve outside the public npm registry or local file references.
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

Use normal npm commands from the relevant project directory:

```bash
npm install <package>
npm ci
```

If a package version was published less than seven days ago, npm will fail the
install. Prefer waiting for the release-age window to pass. For an urgent
security fix, document the reason in the PR and temporarily override the config
for that one command:

```bash
npm_config_min_release_age=0 npm install <package>
```

Do not commit lockfile entries that resolve from git, tarball URLs, or private
registries unless the source has been reviewed and the lockfile-source scanner
is intentionally updated.

## Verification Commands

```bash
npm run security:lock-sources
cd backend && npm ci && npm run lint
cd web && npm ci --legacy-peer-deps && npm run lint && npm run build
```

Registry signature checks are useful during dependency-review work:

```bash
cd backend && npm audit signatures
cd web && npm audit signatures
```

They are not yet enforced in CI because npm ecosystem signature coverage is
still uneven.
