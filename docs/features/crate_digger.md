---
title: "Crate Digger"
status: in-progress
owner: "@akoita"
issue: 1962
---

# Crate Digger

## Status

`in-progress`

Vision Sprint 30 ([milestone 32](https://github.com/akoita/resonate/milestone/32),
epic [#1952](https://github.com/akoita/resonate/issues/1952)). What works today:

- **Crate request API (#1962).** `POST /crates/requests` turns a DJ's text, a
  reference track, or edited filters into an ordered draft crate with honest
  coverage. `GET /crates/:id` returns the owner's crate.
- **`crate.pro` entitlement seam (#1966).** Free for everyone; nothing is gated
  yet.

Not built yet, each tracked in its own issue:

- Crate page with rights summary, transition previews, edit and reorder
  ([#1963](https://github.com/akoita/resonate/issues/1963)).
- Quote and one-signature batched purchase with a receipt per line
  ([#1964](https://github.com/akoita/resonate/issues/1964)).
- rekordbox XML and Serato export
  ([#1965](https://github.com/akoita/resonate/issues/1965)).
- Bounded watching with optional capped auto-buy
  ([#1967](https://github.com/akoita/resonate/issues/1967)).

## Who It Is For

- DJs and producers preparing a set who want rights-clear tracks that mix.
- Artists, indirectly: unmet crate filters are recorded as demand for Scene
  Scout (#1969).
- Backend and frontend developers building the crate page, quote and export.

## Value

A DJ describes what the set needs ("peak-time house, 122–124 BPM, acapella
available, under $20 total") and gets an ordered crate. The filters the request
was turned into are always shown and editable, and the result always says how
much of the request it could fill. Purchases only ever happen on a priced quote
the DJ approved (ADR-TE-1).

Revenue line: Line 3, marketplace take-rate (10%), phase 2 (ADR-BM-6). The
artist keeps at least 85% (ADR-BM-4). No fee change.

## How It Works

1. **Request.** One of `{ text }`, `{ referenceTrackId }` or `{ filters }`, with
   an optional `count` (1 to 25, default 8). Text is limited to 500 characters.
   - Text goes through the deterministic parser (numbers, keys, stem names,
     license words, genre and mood vocabulary). Phrases it cannot read are
     returned as `unparsed`, never guessed. With
     `CRATE_REQUEST_PARSER_STRATEGY=model-assisted` a model may fill fields the
     deterministic parser left open; its output is re-validated and any failure
     falls back to the deterministic result.
   - A reference track contributes its measured tempo (±4%), its Camelot key
     with neighbours, its energy (±0.15) and its genre. It produces the same
     filter structure as a text request.
   - Edited filters are validated and bounded; invalid values return 400 with
     fixed error codes.
2. **Search.** Candidates are publicly playable catalog tracks with their
   measured features (#1960), current stems, active listings and stem prices.
   Fully AI-generated recordings are excluded unless the request allows them.
   Unknown facts never pass a filter: a track with no measured tempo fails a BPM
   filter, and a line with no known price fails a budget.
3. **Ranking.** Passing candidates are ranked by the shared discovery ranker
   with the DJ's taste. Prices and listings are filters the DJ chose, never
   ranking inputs (ADR-TE-2).
4. **Selection and coverage.** Lines are taken best first up to `count` and
   within `maxTotalUsd`. Coverage reports `found` of `requested` and, when the
   crate is short, which filters stood in the way and how many lines relaxing
   each would add.
5. **Ordering.** The crate is ordered as a set path: harmonic compatibility,
   tempo steps and a gentle energy build, with the facts of each transition.
6. **Persistence.** A draft `Crate`, its `CrateItem` lines and a `CrateRequest`
   recording the filters, coverage and unmet filters.

## Privacy

The request text is never stored or logged; `CrateRequest` keeps only the
filters, the number of unparsed phrases and the unmet filter keys. Crates,
crate lines and crate requests are included in the personal data export and
deleted on erasure (see `docs/engineering/personal-data-inventory.md`).

## API Surfaces

| Surface | Purpose |
| --- | --- |
| `POST /crates/requests` | Build a draft crate from text, a reference track or filters (JWT) |
| `GET /crates/:id` | Read one of your crates; other users' crates return 404 (JWT) |

## Configuration

`CRATE_REQUEST_PARSER_STRATEGY`, `CRATE_REQUEST_PARSER_MODEL` and
`CRATE_REQUEST_PARSER_TIMEOUT_MS` are described in
[`docs/deployment/environment.md`](../deployment/environment.md).

## Known Limits

- The candidate pool is bounded to the 500 newest publicly playable tracks;
  coverage is honest about that pool, not the whole catalog.
- Coverage names a filter only when relaxing that filter alone would add lines.
  A crate held back by two filters at once reports the shortfall without a gap.
- "Afro house" and other genres outside the taste-edit vocabulary are reported
  as unparsed rather than mapped.

## Testing

- Unit: `cd backend && npx jest src/tests/crate_ src/tests/model_crate_request_parser.spec.ts src/tests/crates.controller.http.spec.ts`
- Integration (Docker): `cd backend && npm run test:integration -- crates.integration`

## References

- Design: [RFC: Taste Engine §5](../rfc/taste-engine.md)
- Decisions: [ADR-TE-1…7](../strategy/taste-engine-decisions.md)
- Sprint plan: [Vision Sprint 30](../sprints/2026-10-29-vision-sprint-30-crate-digger.md)
- Code: `backend/src/modules/crates/`
