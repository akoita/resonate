# Vision Sprint 58: Safe to show

**Status:** ✅ Closed on 2026-11-25 (all three items merged).
**Milestone:** [Vision Sprint 58: Safe to show](https://github.com/akoita/resonate/milestone/56).
**Goal:** The preview holds nothing it should not, no money can move in it,
and a newcomer can publish without a deposit. First of three sprints to the
free, invitation-only preview. The production opening is a separate stage,
planned and not scheduled.

ADR-BM-6: vision-neutral infrastructure and content protection. No fee, split,
price or payout changes.

## Outcome

- **#2658** (PR #2674): one switch per money and AI-generation surface
  (Shows pledging, paid collects, stem purchases, wallet, agent payments, AI
  generation). Off by default in production, on elsewhere unless switched off.
  A switched-off route answers `403 surface_disabled`; the web hides the entry
  points and the User Guide says when a feature is not available.
- **#2661** (PR #2675): listeners receive a streaming rendition, never the
  uploaded original. A background sweep and an admin backfill create the
  renditions; a track without one answers `503 rendition_not_ready` instead of
  falling back to the original. Public catalog JSON no longer carries storage
  addresses.
- **#2659** (PR #2676): `PUBLISH_DEPOSIT_MODE=none` publishes with attestation
  only. Accounts that are not yet verified get daily and total upload limits,
  shown on the upload page and liftable per artist by an admin.

## Carry-over

- The deployment halves live in the private infrastructure repository: the
  audio bucket (after the rendition backfill) and the curated demo catalog,
  plus the new environment values from this sprint. They need the owner.
- Sprints 59 and 60 continue the path to the preview; the next milestone is
  not yet started from this thread.
