# Vision Sprint 47: Share what you did, show who you back

**Status:** ✅ Closed 2026-10-31. All three items and one follow-up (#2480)
have merged PRs.
**Milestone:** none created (the session cannot create milestones); issues are
tracked from this doc.
**Goal:** Every fan action worth telling people about (licensing a stem,
publishing a remix, backing a show, collecting) offers a tailored share, fans
can choose to show supporter and collector badges without revealing what they
spent or hold, and an owner can cancel an active listing.

## Outcome

| Issue | Result | PR |
| --- | --- | --- |
| #1915 | The stem license purchase and remix publish now offer tailored shares (`marketplace.license_shared`, `remix.published_shared`). The 85% line appears only when the stem's creator made the sale. The listening share keeps its live campaign line, by decision recorded in the Player Action Layer page. The epic is closed | #2485 |
| #1106 | Supporter and collector badges are hidden by default and opted into per type. Each badge is redacted (no wallet, spend, amount or token) and disappears on revocation, expiry, resale, the campaign ending, or a ban | #2483 |
| #284 | "Cancel listing" on active and expiring rows in the Listing Manager, in one smart-account confirmation, with the row flipping to cancelled once confirmed | #2479 |
| #2480 (follow-up) | "Edit listing" changes price or terms in one step: cancel and relist travel in one batched confirmation, and a failure leaves the old listing active | #2482 |

**Decisions to review:**

- The listening share keeps its campaign line (#1915).
- Analytics names use the US spelling `license`, matching the codebase.

**Carry-over:**

- The partner verifier API (#1107) and the Discord / artist-site pilot (#1108).
- There is no UI yet for artists or operators to grant badges or set expiry.
- After an edit, the replaced listing is still reported relistable once the
  indexer records the cancel, as with any cancelled listing.
- Help screenshots for the new share controls and badges were not refreshed.

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
