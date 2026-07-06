# Issue #1390 — Activation ergonomics: prefill escrow + discover campaign id

Kill the copy-paste in the operator activation flow. Two tiers, one PR.

## Tier 1 — prefill the escrow address (frontend only)

`web/src/components/shows/CampaignOperatorPanel.tsx`: the `contractAddress`
state (~line 61) initializes from `campaign.escrowContractAddress ?? ""`. When
empty, default it to the platform-configured escrow for the campaign's chain:
`getContractAddresses(chainId).showCampaignEscrow` (from
`web/src/contracts_abi/index.ts` — verify the export name/signature; it keys by
chain). Use the campaign's chainId (or `NEXT_PUBLIC_CHAIN_ID` default). Only
prefill when the configured address is non-zero (not
`0x0000…0000`); the input stays editable for override. No prefill of a zero
address (leave empty so the button stays disabled). Add a small helper caption
under the field: "Prefilled from platform config — override only if this
campaign uses a different escrow."

## Tier 2 — discover the on-chain campaign id (backend + frontend)

### Backend: `POST /shows/campaigns/:id/discover-onchain`

New operator-only route in `shows.controller.ts` → `shows.service.ts`
`discoverOnChainCampaign(actor, campaignId)`:

1. Load the draft campaign. Resolve the escrow address (its
   `escrowContractAddress` if set, else `configuredShowCampaignEscrowAddress(chainId)`)
   and a `showEscrowClient(chainId)` (both already exist in shows.service).
   If either is missing → `BadRequestException` with a clear message.
2. Read `nextCampaignId()` from the escrow (public getter; the count is
   `nextCampaignId - 1`, ids start at 1). Bound the scan: newest-first, cap at
   the last N (e.g. 200) ids to keep it cheap.
3. For each candidate id, read `campaigns(id)` and match against the draft's
   **on-chain-deterministic** terms (do NOT rely on artistIdHash/authorityHash —
   those are keccak of arbitrary strings the CI create used, not derivable from
   the backend draft):
   - `beneficiary` == draft `beneficiaryAddress` (case-insensitive)
   - `paymentToken` == draft `paymentTokenAddress` (or the resolved default)
   - `goalAmount` == draft `goalAmountUnits` (BigInt equal)
   - `minimumBackers` == draft `minimumBackers`
   - `deadline` == draft funding deadline epoch (seconds; the draft stores an
     ISO `deadline` — convert with `Math.floor(new Date(...).getTime()/1000)`;
     allow no tolerance since the CI create used exact epochs — but if drafts
     can carry sub-second ISO, floor both sides)
   - `bookingDeadline` == draft booking deadline epoch
   Also skip ids whose on-chain status is terminal (Released/Refunded) unless
   you want to report them separately — for activation we only want a live
   (Draft/Active/Funded) match; prefer status Active/Draft.
4. Return `{ matches: [{ contractCampaignId, onChainStatus, beneficiary,
   goalAmount, deadline, bookingDeadline }], escrowAddress }`. Zero matches is a
   200 with `matches: []` (not an error) so the UI can say "none found —
   check terms or enter manually". Multiple matches (possible if two drafts
   share terms) → return all, UI disambiguates.
5. This is READ-ONLY (no key, no signer) — safe. Guard with the operator role
   like the other lifecycle routes (`isPrivilegedActor`).

Add an integration test in `shows.service.integration.spec.ts` using the
Anvil-deployed escrow: create two on-chain campaigns with different terms +
one backend draft matching the second → assert discovery returns the second's
id; assert a draft matching nothing returns `[]`.

### Frontend: "Find on-chain campaign" in the Activation fieldset

`CampaignOperatorPanel.tsx`: add a `discoverShowCampaignOnChain` call in
`web/src/lib/shows.ts` (POST the route, return the matches). In the Activation
fieldset, add a **"Find on-chain campaign"** button next to the inputs:

- on click → call discovery → if one match: fill `contractAddress` +
  `contractCampaignId` and show "Found campaign #N (status …) — review and
  activate". If multiple: render a small pick-list. If none: show the returned
  message and keep manual entry.
- disabled while busy / when not authenticated / when the campaign has no
  beneficiary+terms yet.
- Keep the manual inputs fully functional (discovery is an accelerator, not a
  replacement).

Extend `CampaignOperatorPanel.test.tsx`: the prefill defaults the escrow
input; the discover button calls the lib fn and fills the ids on a single
match. Mock the lib call.

## Docs

- Update `docs/features/resonate_shows.md` operator section: activation now
  prefills the escrow and can discover the on-chain campaign id by matching
  terms (no copy-paste).
- Update the operations runbook activation note.
- User Guide: no change (operator-only surface, not a listener/artist article)
  unless the operator guide article exists — check `web/src/lib/help/content.ts`
  for an operator/activation article and update only if present.

## Gates

- backend: `npx tsc --noEmit`; `npx jest --config jest.config.js --testPathPattern='shows.controller'`; integration `shows.service.integration` (Docker) for the discovery test.
- web: `npx vitest run src/components/shows src/lib`; `npx eslint` changed files; `npm run build`.
- `git diff --check` clean.

## Notes

- Tier 3 (backend-initiated on-chain creation via a platform signer) stays
  deferred with prod prep — out of scope.
- The discovery endpoint also sets up the #1392 smoke to optionally
  self-discover instead of capturing the id from the event log — not required
  now, just a nice alignment.
