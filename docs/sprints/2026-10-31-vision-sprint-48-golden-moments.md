# Vision Sprint 48: Golden moments in every genre

**Status:** ◐ In progress — started 2026-10-31 under the owner's delegated
authority for the night of 2026-10-31 (plan, build and merge until 07:00).
**Milestone:** none created (the session cannot create milestones); the issue
is tracked from this doc.
**Goal:** An artist in any genre can turn a track's best moment into a
collectible: the source can be any separated stem or the full mix, and the
moment carries a genre-appropriate name (Punchline, Crescendo, Hook, Solo).

## Why this theme

- Punchline Drops is shipped and already about 90% source-agnostic (#1476):
  `sourceStemType` is a free string, the clip extractor works on any stem, and
  the fan vocabulary is genre-neutral. The only hard vocals dependency is the
  eligibility gate.
- Opening the mechanic to instrumental genres widens the catalog that can sell
  collectibles without a new product, fee or contract.

## Scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P1 | Business value | [#1476](https://github.com/akoita/resonate/issues/1476) slice 1 | Eligibility accepts any collectible source layer from an allowlist that includes the full mix; the builder gets a source picker (default stays vocals); `no_vocals_stem` becomes `no_source_stem` naming the layer |
| 2 | P2 | Usability | [#1476](https://github.com/akoita/resonate/issues/1476) slice 2 | A `momentKind` label (Punchline, Crescendo, Hook, Solo) drives card and copy flavour; the artist picks it, defaulting from the release genre |

Slice 3 (suggested ranges from measured audio features) stays open on the
issue.

## Defaults taken (owner may override in review)

1. **Sequencing.** #1476 suggested validating the rap funnel first. Both
   slices are small and reversible, and the default source stays vocals, so
   they ship now.
2. **Full-mix clip length.** A full-mix clip carries more of the recording
   than a single stem, so full-mix moments get a tighter maximum length than
   stem moments. The PR records the value and why.
3. **Naming.** The skin labels never use "Drop", which already names the
   collection.

## Exit criteria

- A merged PR with focused backend and web tests green.
- Rights posture unchanged: `NON_COMMERCIAL_COLLECTIBLE`, verified catalogs,
  utility not yield.

## Not in this sprint

- Slice 3 of #1476 (needs the #1184 audio features in the clip selector).
- Paid rail and auctions (#1462, #1470), on-chain claims (#1467).

## Revenue line

- **Line 3** (collectibles): the same ownership product on a larger catalog.
  No new fee or price. ADR-BM-4: utility, not yield; the artist receives at
  least 85% of a paid collect.
