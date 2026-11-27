# Vision Sprint 56

Marked and honest remixes: every piece of generated audio that leaves Resonate carries a machine-readable mark, and three places where the product contradicted its own remix rules are fixed.

- **Marking on every output path:** audio-conditioned drafts and AI part takes are marked. When a key is configured, a render that contains generated audio is never shipped unmarked; the DSP-only path stays fail-open. One inventory of output paths is kept in the Remix Studio feature page and enforced by a test.
- **The real split:** stem pricing shows the split per licence tier from the server's fee, never a constant.
- **Artists can delete their own release:** only published remixes block deletion. Private drafts go with the release, and their creators are told.
- **"Stop" reaches published remixes:** when a source artist revokes remix consent, withdraws the release, has the track held or taken down, or has their account erased, each published remix of it leaves discovery and stops selling at the quote. Sold licences are honoured, and the hold lifts when the cause does.

Application milestone: [#54](https://github.com/akoita/resonate/milestone/54). All six items shipped; two parts of one follow-up move to the backlog. This is a changelog for the milestone, not a software version or deployment event.

## Shipped work

- [#2602](https://github.com/akoita/resonate/issues/2602): marking on every generated-audio output path.
- [#2599](https://github.com/akoita/resonate/issues/2599): canonical split in stem pricing.
- [#2600](https://github.com/akoita/resonate/issues/2600): private drafts no longer block release deletion.
- [#2601](https://github.com/akoita/resonate/issues/2601): source holds on published remixes.
- [#2606](https://github.com/akoita/resonate/issues/2606) item 1: account erasure places the same holds.
- Carried from Sprint 54: [#2574](https://github.com/akoita/resonate/issues/2574) (disclosure) and [#2575](https://github.com/akoita/resonate/issues/2575) (admin detect).

## Merged pull requests

[#2603](https://github.com/akoita/resonate/pull/2603) (plan), [#2604](https://github.com/akoita/resonate/pull/2604), [#2605](https://github.com/akoita/resonate/pull/2605), [#2607](https://github.com/akoita/resonate/pull/2607), [#2608](https://github.com/akoita/resonate/pull/2608), [#2609](https://github.com/akoita/resonate/pull/2609), [#2616](https://github.com/akoita/resonate/pull/2616), [#2709](https://github.com/akoita/resonate/pull/2709) (AI tags kept on streaming renditions, AI label in the player), and the closure pull request.

## Carry-over and owner decisions

- [#2606](https://github.com/akoita/resonate/issues/2606) stays open, with no milestone, for items 2 and 3. Item 2 (purchase routes where the payment comes first) waits until sales are back in scope. Item 3 (lifting `source_under_review` when a quarantine clears) waits for a review-clear action, which does not exist yet.
- The parent epic [#2589](https://github.com/akoita/resonate/issues/2589) stays open for roadmap phases P1 to P3.
