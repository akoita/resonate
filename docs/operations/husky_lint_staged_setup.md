---
title: "Phase 2: Husky + Lint-Staged Setup"
status: draft
owner: "@akoita"
issue: 101
---

# Phase 2: Husky + Lint-Staged Setup

## Goal

Add pre-commit hooks to enforce staged linting for web and backend changes.

## Actions

1. **Repo tooling**
   - Add root `package.json` with Husky + lint-staged.
   - Configure lint-staged to target `web/` and `backend/`.
2. **Backend lint**
   - Add a `lint` script to run `tsc --noEmit`.
3. **Git hooks**
   - Add a pre-commit hook that runs lint-staged.

## MVP Acceptance Criteria

- `npm install` at repo root installs Husky + lint-staged.
- `npm run prepare` registers the Git hooks.
- Staged changes in `web/` run `npm --prefix web run lint`.
- Staged changes in `backend/` run `npm --prefix backend run lint`.

## Dependencies

- Phase 2: Alpha (Project Resonate specs).
