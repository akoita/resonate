# Vision Sprint 58

Safe to show: the preview can hold nothing it should not, no money has to move in it, and a newcomer can publish without a deposit.

- **Product surface switches:** one switch per money and AI-generation surface (Shows pledging, paid collects, stem purchases, wallet, agent payments, AI generation). Off by default in production, on elsewhere unless switched off. A switched-off feature is hidden in the app and refused by the server, and the User Guide says so.
- **Streaming renditions:** listeners receive a copy made for streaming, never the artist's uploaded file. Older tracks are converted by a background sweep or an admin backfill; until then a track says it is not ready rather than serving the original.
- **Publishing without a deposit:** a deployment can publish with attestation only. Accounts that are not yet verified have daily and total upload limits, shown on the upload page, which an admin can lift per artist.

Application milestone: [#56](https://github.com/akoita/resonate/milestone/56). All three items shipped. This is a changelog for the milestone, not a software version or deployment event.

## Shipped work

- [#2658](https://github.com/akoita/resonate/issues/2658): product surface switches.
- [#2661](https://github.com/akoita/resonate/issues/2661): streaming renditions.
- [#2659](https://github.com/akoita/resonate/issues/2659): publishing without a deposit, with upload limits.

## Merged pull requests

[#2674](https://github.com/akoita/resonate/pull/2674), [#2675](https://github.com/akoita/resonate/pull/2675), [#2676](https://github.com/akoita/resonate/pull/2676), [#2677](https://github.com/akoita/resonate/pull/2677) (closure).

## Carry-over and owner decisions

- The deployment halves (audio storage, demo catalog, new environment values) are tracked privately and need the owner.
- Production opening is planned and not scheduled.
