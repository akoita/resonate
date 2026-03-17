# Issue 454 Plan

## Goal

Remove the last stale infrastructure guidance from this repository's docs after the
IaC extraction to `resonate-iac`.

## Scope

- Update `CONTRIBUTING.md` so it no longer references removed local infrastructure
  targets such as `make dev-up` and `make worker-logs`.
- Point infra changes and local stack startup to `https://github.com/akoita/resonate-iac`.
- Keep app-local commands in this repo (`make backend-dev`, `make web-dev`, etc.).

## Verification

- Search tracked docs for stale references to removed IaC targets.
