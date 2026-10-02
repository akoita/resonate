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
- **Crate page (#1963).** `/crates` takes a sentence (or starts from a track
  with "Start a crate from this track") and lists your crates. `/crates/:id`
  shows each line's BPM, Camelot key, energy, stems with quality scores and
  license options with what each grants, plus a beat-aligned transition preview
  into the next line. The DJ can reorder, lock, remove and swap lines, rename
  and save the crate, and edit the filter chips to build a new crate.
- **Quote, one-signature purchase and receipts (#1964).**
  `POST /crates/:id/quote` prices the crate's lines from the chain for the DJ to
  approve; `POST /crates/:id/quotes/:quoteId/settle` verifies the transaction
  the DJ's smart account sent and records a receipt per stem. The crate page's
  **Buy this crate** panel gets a quote, lets the DJ change a line's license and
  stems (every change prices the whole quote again), checks every line against
  the chain, and sends one batched user operation after a confirm step. Receipts
  show per stem and come back when the crate is reopened. `StemPurchase` is
  indexed per `Sold` log, so a batch of N buys records N purchases.
- **Export to rekordbox and Serato (#1965).**
  `POST /crates/:id/export` with `{ format, folder }` builds the file
  from the stems the DJ owns for the crate's tracks; `GET /crates/:id/export/manifest`
  lists them with the names to save them under, and the lines left out with a
  reason. The crate page's **Export to rekordbox or Serato** panel downloads
  each stem through the existing licensed download path, remembers the folder
  per browser, and saves the file. Export never grants a right.
- **`crate.pro` entitlement seam (#1966).** Free for everyone; nothing is gated
  yet. The crate page reads it from the crate response.

Not built yet, each tracked in its own issue:

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
7. **Editing.** Reorder, lock and remove are saved together with the title
   when the DJ saves; saving moves the crate from draft to saved (the future
   `crate.pro` limit applies only to new saves and never hides a crate). Swap
   replaces one unlocked line with the best-ranked track that passes the same
   filters, is not already in the crate and keeps it within the total budget.
8. **Rights before any quote.** Each line lists the license tiers it offers.
   Personal, remix and commercial show what they grant; sync, sample and
   broadcast have no standard Resonate terms yet and say so. Prices are
   indicative; the quote (#1964) sets the binding price.
9. **Quote (backend).** `POST /crates/:id/quote` takes optional
   `lines: [{ trackId, licenseType?, stemTypes? }]` (max 25 lines, 6 stem types
   each; omitted means every line). Per line the tier is the DJ's choice, else
   the crate's license filter, else the cheapest tier with an active listing;
   the stems are the DJ's choice, else the crate's required stems, else every
   listed stem at the tier. For each stem the cheapest active database listing
   on the configured marketplace is picked, then **the chain is read**
   (`getListing`, `quoteBuy`): price, payment token, seller and expiry come from
   the contract, never from the possibly stale database row. A stem that cannot
   be bought is stored as a dropped item with a fixed reason: `not_listed`,
   `sold_out`, `expired`, `own_listing`, `unverifiable` (the chain could not be
   read, or disagrees with the database on the token) or `token_not_supported`
   (no configured payment asset). The quote expires after 10 minutes or at the
   earliest on-chain expiry. It carries per-item raw units and display amounts,
   what the artist side receives (seller plus royalty), the platform fee,
   totals per payment token, a USD total (null when any token's USD value is
   unknown) and whether it is over the crate's `maxTotalUsd`.
10. **Settlement (backend).** The browser sends one batched user operation from
    the DJ's smart account, then calls `.../settle` with the transaction hash
    and any lines it left out (`simulation_failed`, `insufficient_balance`,
    `listing_changed`, `deselected`). The backend reads the receipt: no receipt
    yet answers 202 (retry), a reverted transaction fails the quote, and a mined
    one matches the quoted stems to the marketplace `Sold` logs of the DJ's own
    account by listing and amount, each log once. The quote becomes `settled`,
    `partial` or `failed`; unmatched stems are `failed` with
    `not_in_transaction`; a transaction mined before the quote fails it with
    `transaction_before_quote`. Only then is the taste purchase signal recorded once
    per settled track and the stem quality validation once per settled stem.
    The chain is the truth: an expired quote still settles a mined transaction.
11. **Buying from the crate page (web).** The panel is in `web/src/components/crates/`
    (`CrateQuotePanel`, `CrateQuoteView`); the rules live in plain modules under
    `web/src/lib/` so they are unit tested without a wallet.
    1. *Get a quote* sends `{ buyerAddress }`, the smart account the page signs
       with (kernel account, else stored smart account, else sign-in address).
       It needs saved lines: a quote prices the crate as it is saved. Changing a
       line's license or a stem sends every line again with its choices
       (`lines` limits a quote to the lines it lists), and the last stem of a
       line cannot be switched off.
    2. *Approve and buy* opens a confirm step listing exactly the stems that will
       be bought and the total. Nothing is sent before it, and nothing is sent for
       a quote that is not open, has expired, was priced for another buyer,
       network or marketplace than the page's, or is missing a price.
    3. *Chain check* (`crateQuotePreflight.ts`). Each line's `getListing` and
       `quoteBuy` are read again. A line is left out as `listing_changed` when the
       listing is gone, has fewer units, expires within a minute, is paid in another
       token, or `quoteBuy` differs from the quoted total. Then, per token, lines
       are left out from the end of the quote order as `insufficient_balance`
       until the buyer's balance covers the rest (native: the value sum against
       the native balance). Then, when the RPC supports `eth_simulateV1`, the final
       batch is simulated: a failing buy leaves out its line, a failing approve
       leaves out every line of that token (`simulation_failed`), and the batch is
       simulated again, at most once per line. A chain read that fails aborts
       before any signature.
    4. *Left-out lines.* When any line was left out, the DJ sees which and why and
       is asked whether to buy the rest; a refusal sends nothing. The quote's
       expiry is checked again after that wait.
    5. *One signature.* `buildCrateBatchPlan` makes one ERC-20 `approve` per
       distinct token for the exact sum, then one `buy` per line in quote order,
       native lines carrying their own value. A batch with no buy is never
       built. All amounts are bigint units.
    6. *Settlement.* The hash and the left-out lines go to `.../settle`; a 202
       (no receipt yet) is retried after 2, 4, 8 and 16 seconds, then the panel
       says it is still confirming with a *Check again* button. Server hiccups
       are retried the same way; a conflict (`transaction_already_used`) stops and
       shows the transaction.
    7. *Receipts.* Per stem: bought, not bought or left out, each with a plain
       reason and the transaction link. Once a transaction was sent for a quote,
       that quote cannot be approved again.
12. **Transition preview.** The browser crossfades the two lines' previews over
   eight beats at the outgoing tempo, tempo-matching the incoming line within
   ±8%. Deterministic DSP only; nothing is generated.

13. **Export (#1965).** Resonate sells stems, not full mixes, so an export entry
    is a stem the DJ owns, not a track.
    1. *What is exportable.* A current stem of a crate track covered by a
       `StemPurchase` of the caller's `Wallet.address` (the ownership rule of
       `POST /encryption/download`) under a personal, remix or commercial
       license. All three standard tiers include the full-quality stem download
       (`docs/rfc/business-model.md`). A purchase under `sync`, `sample` or
       `broadcast` has no standard terms: that line is skipped
       `no_export_right`. A line with no purchased stem is skipped
       `not_purchased`. Entries are deduplicated by stem and ordered by crate
       position, then stem type (vocals, drums, bass, piano, guitar, other).
       The seam decision `CrateEntitlementsService.export` is free for
       everyone; a future denial answers 403 `pro_required`.
    2. *File names.* The backend decides them: `Artist - Title (Stem).mp3`,
       stripped of `<>:"/\|?*` and control characters, spaces collapsed,
       leading and trailing dots and spaces trimmed, at most 150 characters
       before the extension; a collision inside one export appends
       ` [first 6 characters of the stem id]`. The web saves each downloaded
       stem under the manifest's `fileName`, so the export files and the disk
       agree.
    3. *Measured facts.* Tempo, key and first beat come from the stem's own
       `audioFeatures`, else from the track's measured features (its `original`
       stem); the first beat follows the tempo it is paired with. The platform's
       confidence gates apply, and nothing is guessed.
    4. *The folder.* rekordbox and Serato reference files on the DJ's disk, so
       the export takes `folder`, the absolute path the DJ typed (`/Users/...`
       or `C:\...`, at most 400 characters, no control characters, no `.` or
       `..` segment; otherwise 400 `invalid_folder`). It is written into the
       file and nowhere else: never stored, never logged, never in an error
       message. The web remembers it in `localStorage` only.
    5. *rekordbox XML.* `DJ_PLAYLISTS` 1.0.0 with a `COLLECTION` of `TRACK`
       elements (`Name` is `Title (Stem)`, `Album` the crate title, `Location`
       `file://localhost/` plus the percent-encoded path, `AverageBpm`,
       `Tonality` such as `Am` or `F#m`), a `TEMPO` child and a `First beat`
       memory cue only when both a tempo and a first beat were measured, and a
       playlist of the crate title in crate order.
    6. *Serato crate.* A binary `.crate`: a `vrsn` tag, then one `otrk` tag per
       entry holding a `ptrk` tag with the path relative to the volume root, all
       UTF-16BE (POSIX drops the leading `/`, and `Volumes/<name>/` for a mounted
       volume; Windows drops the drive). Serato reads tempo, key and cues from
       its own analysis or the file's tags, so the crate carries none of them.
    7. *Routes.* The file route is `POST` with a JSON body `{ format, folder }` (a class DTO whose fields the service checks, so a missing, mistyped or repeated value still answers the fixed code). `format` is validated first (400 `invalid_format`), then the
       folder (400 `invalid_folder`), then the entitlement, the crate (another
       user's is a 404), the wallet (409 `no_wallet`) and the entries (409
       `nothing_to_export` for the file routes; the manifest still answers 200
       with empty `entries`). Both are throttled like the other crate routes
       and answer `Cache-Control: no-store`. The file route answers
       `application/xml; charset=utf-8` (`<crate title>.xml`) or
       `application/octet-stream` (`<crate title>.crate`) with
       `Content-Disposition: attachment` and an RFC 5987 `filename*`; the API
       exposes `Content-Disposition` to the browser for it.

## Privacy

The export folder, which can contain the DJ's username, is only written into
the generated file. It travels in the `POST` body, never in a URL, so proxy and
load balancer URL logs cannot capture it. The API never stores or logs it and
the web helper does not use the logging request wrapper. The request text is never stored or logged; `CrateRequest` keeps only the
filters, the number of unparsed phrases and the unmet filter keys. Crates,
crate lines and crate requests are included in the personal data export and
deleted on erasure (see `docs/engineering/personal-data-inventory.md`).

## API Surfaces

| Surface | Purpose |
| --- | --- |
| `POST /crates/requests` | Build a draft crate from text, a reference track or filters (JWT) |
| `GET /crates` | List your crates, most recently edited first (JWT) |
| `GET /crates/:id` | Read one of your crates; other users' crates return 404 (JWT) |
| `PATCH /crates/:id` | Rename, save, reorder, lock or remove lines (JWT) |
| `POST /crates/:id/items/:trackId/swap` | Swap one unlocked line for a similar track (JWT) |
| `POST /crates/:id/quote` | Price lines from the chain for approval; 400 `invalid_lines` / `invalid_buyer_address`, 409 `no_wallet` / `wallet_mismatch`, 503 `marketplace_unavailable` (JWT) |
| `GET /crates/:id/quotes/:quoteId` | Read a quote with its receipts; other users' quotes return 404 (JWT) |
| `POST /crates/:id/quotes/:quoteId/settle` | Report the transaction and verify it from the chain; 202 while pending, 409 `already_submitted` (JWT) |
| `GET /crates/:id/export/manifest` | The stems you own for the crate with their download names, the lines left out and why, and notes; 200 even when empty; 404 / 409 `no_wallet` / 403 `pro_required` (JWT) |
| `POST /crates/:id/export` `{ format: "rekordbox"\|"serato", folder }` | The rekordbox XML or Serato crate for the stems you own (200 with the file). The folder is in the body, not the URL: #1965 first said `GET` with a query string, changed for privacy because proxies and load balancers log URLs. 400 `invalid_format` / `invalid_folder`, 404, 409 `no_wallet` / `nothing_to_export`, 403 `pro_required` (JWT) |
| `GET /crates/:id` `latestQuote` | The crate's most recent quote, or null |
| `/crates`, `/crates/:id` | Crate Digger request box, crate list and crate page with the quote and purchase panel |

## Configuration

`CRATE_REQUEST_PARSER_STRATEGY`, `CRATE_REQUEST_PARSER_MODEL` and
`CRATE_REQUEST_PARSER_TIMEOUT_MS` are described in
[`docs/deployment/environment.md`](../deployment/environment.md). Quotes read
the chain with the indexer's existing `RPC_URL`, `MARKETPLACE_ADDRESS` (and the
per-chain variants) and `INDEXER_CHAIN_ID` / `CHAIN_ID` / `AA_CHAIN_ID`; payment
tokens come from `PAYMENT_ASSETS_JSON`. No new variable.

## Known Limits

- The candidate pool is bounded to the 500 newest publicly playable tracks;
  coverage is honest about that pool, not the whole catalog.
- Coverage names a filter only when relaxing that filter alone would add lines.
  A crate held back by two filters at once reports the shortfall without a gap.
- "Afro house" and other genres outside the taste-edit vocabulary are reported
  as unparsed rather than mapped.
- The coverage banner shows right after a crate is built; reopening a crate
  later shows its lines and filters without the coverage numbers.
- Editing the filter chips builds a new crate; the original stays in the list.
- A quote buys one unit of each stem. It lives 10 minutes (or less if a listing
  expires sooner) and prices are read when it is created, not live.
- A payment token with no configured payment asset is never quoted
  (`token_not_supported`), because its decimals would be a guess.
- A track that is no longer publicly playable is reported as not listed. A
  requested stem type the track does not have is left out of the quote.
- Receipts are verified from the chain: a stem counts as bought only when the
  marketplace emitted a `Sold` log to the quote's buyer. The quote records the
  chain head when it was priced; a transaction mined at or before that block
  fails the quote (`transaction_before_quote`), and one transaction can settle at
  most one quote (409 `transaction_already_used`).
- The quote buys for the wallet on file (`Wallet.address`). The web should send
  the smart account it will sign with as `buyerAddress`; a different address is
  a 409 `wallet_mismatch` ("sign in again"), and omitting it behaves as before.
  `Wallet.address` is rewritten at every passkey sign-in, but
  `WalletService.refreshWallet` (the `/wallet/aa/enable`, `/wallet/aa/refresh`
  and `/wallet/agent/enable` routes) can overwrite it with a derived
  pseudo-address until the next sign-in. That is tracked in
  [#2023](https://github.com/akoita/resonate/issues/2023) and not
  changed here; the `buyerAddress` check is what protects a quote from it.
- If the chain cannot be read when settling, the quote stays `submitted` and
  the web retries.
- The chain simulation needs an RPC that supports `eth_simulateV1`. Without it
  (method not found or not supported) the web relies on the read checks only,
  which cannot catch a revert that only a simulation shows. Any other simulation
  failure aborts the purchase before the signature.
- The web stores the transaction hash in the browser's `localStorage` the
  moment it exists and clears it once the quote is final, so a page that closes
  before settlement was recorded reopens with *Check again* instead of offering
  the same stems again. On another browser or device, or with storage cleared,
  the quote reads `open` until it expires and shows no receipt until a settle
  call for that transaction succeeds; the purchase itself is on chain and in the
  wallet. If the wallet times out after the transaction was mined, nothing is
  stored and the same applies.
- A failed wallet step that is not a cancelled prompt does not claim "nothing
  was charged": it may have failed after the network accepted the operation.
- A quote is only approvable on the chain and marketplace the page is
  configured for (`NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_*MARKETPLACE_ADDRESS`).
- The signing path cannot run under mock auth; the Playwright flow covers the
  panel and the API calls, and unit tests cover the plan, the chain check and
  the purchase sequence.

- Export lists one file per owned stem and never a full mix. The folder is typed
  by the DJ and not checked against their disk; a wrong folder gives a file
  whose paths do not resolve, and the DJ software shows the tracks as missing.
- The Serato crate carries no tempo, key or cue; only the rekordbox XML carries a
  tempo grid and a first-beat cue. A stem with no measured tempo has none.
- The download path does not check track availability, and neither does the
  export: an owned stem of a track that has since been withdrawn is still listed.
- The export list is read from the saved crate; unsaved edits are flagged, not
  exported. The browser may ask permission to save several files at once.
- Key names use sharp spellings (`A#m`, not `Bbm`), as the platform's key tables
  do.

## Testing

- Unit: `cd backend && npx jest src/tests/crate_ src/tests/model_crate_request_parser.spec.ts src/tests/crates.controller.http.spec.ts` (includes the quote rules in `crate_quote.spec.ts` and the viem reader in `crate_marketplace_reader.spec.ts`)
- Export: `cd backend && npx jest src/tests/crate_export.spec.ts` (byte-exact rekordbox XML and Serato crate against the fixtures in `src/tests/fixtures/crate-export/`) and `npm run test:integration -- crate_export.integration` (real Prisma: ownership, skipped reasons, manifest, the folder never persisted)
- Web: `cd web && npx vitest run src/lib/crates.test.ts src/lib/crateExport src/lib/crateTransitionPreview.test.ts src/lib/crateQuote src/lib/onchainCheckout.test.ts src/components/crates`
- Web flow (mock auth, no backend data; the dev server and the tests must agree on `NEXT_PUBLIC_CHAIN_ID` and `NEXT_PUBLIC_MARKETPLACE_ADDRESS`): `cd web && npx playwright test tests/crate-digger.spec.ts --project=chromium`
- Integration (Docker): `cd backend && npm run test:integration -- crates.integration crate_quote.integration flow2_contracts` (the quote spec replaces the chain with a fake reader; Prisma is real)
- Contracts (Foundry): `cd contracts && forge test --match-path test/unit/StemMarketplace.t.sol --match-test BatchBuy` (one approval and several buys in one call match `quoteBuy`; one expired line reverts the whole batch)

## References

- Design: [RFC: Taste Engine §5](../rfc/taste-engine.md)
- Decisions: [ADR-TE-1…7](../strategy/taste-engine-decisions.md)
- Sprint plan: [Vision Sprint 30](../sprints/2026-10-29-vision-sprint-30-crate-digger.md)
- Code: `backend/src/modules/crates/`, `web/src/components/crates/`, `web/src/lib/crateQuote*.ts`
