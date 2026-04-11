# Issue 448 Plan

## Goal

Remove the migrated infrastructure-as-code surface from this repository while preserving
app-local development and contract workflows that still belong in `resonate`.

## Scope

- Remove migrated IaC assets:
  - `infra/terraform/`
  - `docker-compose*.yml`
  - `.github/workflows/deploy.yml`
  - `.env.deploy.example`
- Remove or replace Makefile targets that depended on deleted IaC files.
- Relocate helper scripts that are still app-owned into domain-specific locations.
- Update README and docs to point infrastructure setup and deployment workflows to
  `https://github.com/akoita/resonate-iac`.

## Working Assumptions

- CI must continue to work after deletion, so any remaining workflow dependency on removed
  files must be updated first.
- Root-level deployment and environment bootstrapping are now owned by `resonate-iac`.
- Contract deployment/configuration helpers still belong with the contracts codebase and can
  stay in this repo if they are moved out of the migrated root IaC surface.

## Planned Changes

1. Remove the migrated IaC directories/files from the repo root.
2. Move contract/configuration helper scripts under `contracts/scripts/`.
3. Move backend-admin/security helper scripts under `backend/scripts/`.
4. Move the evmbench packaging helper next to its docs.
5. Rewrite docs and Makefile help text so infrastructure steps reference `resonate-iac`.
