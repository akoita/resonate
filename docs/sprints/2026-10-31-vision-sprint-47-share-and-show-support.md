# Vision Sprint 47: Share what you did, show who you back

**Status:** ◐ In progress — started 2026-10-31 under the owner's delegated
authority for the night of 2026-10-31 (plan, build and merge until 07:00).
**Milestone:** none created (the session cannot create milestones); issues are
tracked from this doc.
**Goal:** Every fan action worth telling people about (licensing a stem,
publishing a remix, backing a show, collecting) offers a tailored share, fans
can choose to show supporter and collector badges without revealing what they
spent or hold, and an owner can cancel an active listing.

## Why this theme

- Sprint 45 shipped the campaign and collectible shares (#1916, #1917). The
  parent #1915 still lists the stem-licence and remix-publish shares and the
  listening-share campaign link to revisit. Finishing it closes the epic.
- Supporter and collector badges (#1106) turn existing proofs into visible fan
  identity, opt-in and privacy-first, with no money change.
- Listing cancellation (#284) is a long-standing marketplace gap; the indexer
  already listens for `contract.listing_cancelled`.

## Scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P1 | Business value | [#1915](https://github.com/akoita/resonate/issues/1915) (remaining slices) | Stem-licence purchase share and remix-publish share with the shared toolkit; listening-share campaign link revisited; epic closed |
| 2 | P1 | Usability | [#1106](https://github.com/akoita/resonate/issues/1106) | Opt-in public supporter and collector badges, separate from eligibility, redacted, revocable |
| 3 | P1 | Usability | [#284](https://github.com/akoita/resonate/issues/284) | "Cancel listing" on listed items, wired to the contract, with immediate UI update |

## Defaults taken (owner may override in review)

1. **#1915:** the listening share keeps the live campaign link only when no
   campaign share was offered in the same session; otherwise unchanged. The
   agent may keep it as is if removing it loses reach, and records why.
2. **#1106:** badges are hidden by default; showing them is per badge type.

## Not in this sprint

- #1907 (needs the owner's call on metering model-backed "Describe it").
- #2378 (needs the legal answer on standing consent).

## Revenue line

- **Line 1** (Shows) and **line 3** (marketplace, licences, collectibles):
  #1915 growth shares and #284. ADR-BM-4 copy rules apply.
- **Vision-neutral** identity/quality: #1106 (no yield, no spend shown).
