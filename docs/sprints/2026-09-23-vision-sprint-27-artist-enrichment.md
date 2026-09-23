# Vision Sprint 27: Trustworthy artist profile enrichment

**Status:** Closed 2026-09-23; [milestone changelog](https://github.com/akoita/resonate/releases/tag/milestone-29-vision-sprint-27-artist-enrichment) published.
**Milestone:** [29](https://github.com/akoita/resonate/milestone/29).
**Goal:** An authorized artist or manager can choose the correct public artist
identity, review source-backed AI suggestions, and approve exactly which
profile fields are saved.

## Approved scope and order

The sole admitted issue is [#1763](https://github.com/akoita/resonate/issues/1763).
There is no carry-over from Sprint 26 and no due date. This is one substantial
cross-stack workstream, consistent with Sprint 26 capacity.

1. Choose permitted public sources, image-use rules, and a clear uncertainty
   label for each suggestion.
2. Implement explicit candidate selection, source-linked suggestions, and
   selective approval in the authorized profile editor.
3. Verify authorization, preservation of existing values, partial and failed
   provider responses, focused tests, the User Guide, and feature docs.

The closed foundations are [#1492](https://github.com/akoita/resonate/issues/1492),
[#1762](https://github.com/akoita/resonate/issues/1762), and
[#1856](https://github.com/akoita/resonate/issues/1856). They establish stable
artist IDs, delegated profile-edit authority, and private claim review.

## Delivered outcome

[PR #1859](https://github.com/akoita/resonate/pull/1859) closed #1763 at
`855bb04830c4c0d72a748a356143b8adc92c83e8`. An authorized profile editor
can opt in to searching MusicBrainz candidates, select one exact identity, and
review source-linked field suggestions before adding selected values to the
profile form. Existing values require explicit replacement approval. The
normal Save changes action is the only write step, so dismissing suggestions
does not change the profile.

The backend checks profile-edit authority before calling providers, limits
request rates and concurrent AI drafts, and bounds public-source responses.
Wikidata supplies structured facts; Commons images are suggested only when
their metadata identifies CC0 or Public Domain. Gemini can draft a short bio
from public facts but cannot write a profile. Empty, ambiguous, partial,
unavailable, and rate-limited paths have explicit UI handling. The User Guide,
feature catalog, architecture reference, and screenshot were updated in the
same PR. Approved field values are stored without persistent per-field source
metadata; that limitation remains documented in the PR.

## Verification and release boundary

The exact merged source passed [main CI](https://github.com/akoita/resonate/actions/runs/35928528476).
The [release preview](https://github.com/akoita/resonate/actions/runs/35929229520)
validated that source and CI run. [Release Deployment](https://github.com/akoita/resonate/actions/runs/35929272671)
reran exact-source gates, published immutable backend, frontend, and Demucs
images, and handed off a digest-bound manifest. Private infrastructure
reconciliation and successful staging deployment evidence are retained in
`resonate-iac` [#251](https://github.com/akoita/resonate-iac/issues/251).

This is a milestone release, separate from a SemVer software release. It does
not claim a production deployment. All admitted Sprint 27 work is complete;
the next milestone has not yet been selected.

[Closeout PR #1860](https://github.com/akoita/resonate/pull/1860) merged at
`3e94ba45ee461aace6993098c4af41f73d253055`; its
[main CI](https://github.com/akoita/resonate/actions/runs/35933738777) passed,
and milestone 29 is closed.

## Exit and boundaries

An enrichment request must be opt-in. Same-name candidates remain separate,
and the requester selects an exact identity. Suggestions show sources and
uncertainty; only selected fields enter the form, and replacing existing
values needs explicit confirmation. Saving uses the current authorized profile
update path. External content cannot grant authority or trigger a write.
Success, empty, ambiguous, unavailable, rate-limited, and malformed responses
need focused verification.

[#1846](https://github.com/akoita/resonate/issues/1846) guide screenshots,
[#1450](https://github.com/akoita/resonate/issues/1450) engagement marts, and
[#1776](https://github.com/akoita/resonate/issues/1776) checkout compliance
remain outside this milestone. This is `vision:keep` profile quality under
ADR-BM-6; no fee, split, licensing, payout, or ADR-BM-4 rule changes.
