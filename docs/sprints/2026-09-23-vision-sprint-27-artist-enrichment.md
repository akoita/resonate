# Vision Sprint 27: Trustworthy artist profile enrichment

**Status:** In progress.
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
