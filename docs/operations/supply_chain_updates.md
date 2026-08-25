# Supply-Chain Input Updates

Resonate reviews executable build inputs through ordinary pull requests. The
readable version/tag and immutable commit or digest must move together; do not
update a comment while retaining an old commit, or replace a digest without
reviewing the corresponding release.

## Dependabot update cadence and grouping

Routine minor and patch version updates are grouped monthly by ecosystem.
Security updates remain immediate and event-driven, but supported ecosystems
receive one grouped security pull request per ecosystem. Do not merge small,
superseded security pull requests individually; cross-ecosystem updates remain
separate by GitHub design. Review the lifecycle-policy tuple whenever grouped
lockfile changes update a package with an install script.

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
