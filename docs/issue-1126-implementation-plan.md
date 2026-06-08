# Issue #1126 Implementation Plan

## Scope

Implement the artist/operator management slice for community holder benefit
rules. This continues the holder benefits plan after the backend eligibility
foundation from #998.

## In Scope

- Add authenticated artist/admin APIs to list holder benefit rules for an
  artist.
- Add authenticated artist/admin APIs to create draft or active benefit rules.
- Add authenticated artist/admin APIs to pause and expire benefit rules.
- Validate supported benefit types, eligibility policies, redemption policies,
  titles, descriptions, and time windows before persistence.
- Emit compact governance events for rule creation and lifecycle changes.
- Add an artist-facing management surface under the existing artist/community
  area.
- Update feature docs and tests in the same branch.

## Out Of Scope

- Public supporter or collector credentials.
- New NFT-backed benefit credentials.
- Listener-facing benefits dashboard or public profile showcase changes.
- Automatic benefit execution or off-platform fulfillment.
- Exposing wallet addresses, raw ownership proofs, raw policy internals, or
  per-listener eligibility details in artist/public DTOs.

## API Shape

Planned routes:

- `GET /community/artists/:artistId/benefit-rules`
- `POST /community/artists/:artistId/benefit-rules`
- `POST /community/artists/:artistId/benefit-rules/:ruleId/pause`
- `POST /community/artists/:artistId/benefit-rules/:ruleId/expire`

All routes require the artist owner, `operator`, or `admin`.

## Supported First Policies

The first management UI should expose safe templates that map to existing
server-side policy primitives:

- stem ownership: holder benefit for indexed stem/NFT ownership;
- campaign support: Shows supporter benefit from confirmed/released support;
- badge/role based: benefit unlocked by existing private community proof.

Advanced raw JSON editing should not be the default artist path.

## Privacy Boundary

Management responses may include rule metadata and high-level policy summaries,
but must not expose listener identities, wallet addresses, raw ownership rows,
raw pledge rows, or per-listener eligibility. Eligibility remains evaluated
server-side from trusted indexed state.

## Validation

- Backend HTTP/service coverage for list/create/pause/expire authorization and
  validation.
- Event emission tests for rule lifecycle governance events.
- Frontend component/API tests for empty, create, pause, expire, loading, and
  error states.
- Feature catalog and holder benefits plan updates.
