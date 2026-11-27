# Vision Sprint 54

Traceable remixes: every remix render (draft master, rendered stems, DJ extended export) carries an inaudible watermark that ties a copy found elsewhere back to the render it came from, an admin can read it back from a clip, and creators are told before they export.

- **Scheme picked:** audiowmark at strength 15, run as a separate process. The spike recovered the token from every 30-second real-render excerpt in the attack set, with no false positive on the unwatermarked proxy set.
- **Marked at render time:** an opaque 128-bit token per render job, never a user id, wallet or email, recorded in an admin-only token table. Prompt-only drafts are marked too, free on every tier. With no key configured, renders proceed unmarked and say so in their metadata.
- **Disclosed:** licence text, the studio export panel, the privacy policy and the Remix guide say renders carry the mark.
- **Admin detect:** an admin checks a clip against the active and retired keys and attaches the result to a dispute as evidence, with copy that says a token proves which render, not who uploaded it.
- **SynthID endpoint check:** the audio verify client is marked unverified, and a failed check is no longer reported as "no watermark".

Application milestone: [#52](https://github.com/akoita/resonate/milestone/52). All five slices shipped. This is a changelog for the milestone, not a software version or deployment event.

## Shipped work

- [#2572](https://github.com/akoita/resonate/issues/2572): watermark scheme spike.
- [#2573](https://github.com/akoita/resonate/issues/2573): embed at render time, with the token table.
- [#2574](https://github.com/akoita/resonate/issues/2574): disclosure in licences, the export panel and the guide.
- [#2575](https://github.com/akoita/resonate/issues/2575): admin detect action and dispute evidence.
- [#2576](https://github.com/akoita/resonate/issues/2576): SynthID audio verify endpoint check.

## Merged pull requests

[#2579](https://github.com/akoita/resonate/pull/2579), [#2587](https://github.com/akoita/resonate/pull/2587), [#2608](https://github.com/akoita/resonate/pull/2608), [#2609](https://github.com/akoita/resonate/pull/2609) (audio-conditioned drafts), [#2611](https://github.com/akoita/resonate/pull/2611) (embedder in the backend image), [#2615](https://github.com/akoita/resonate/pull/2615), [#2617](https://github.com/akoita/resonate/pull/2617), and the closure pull request.

## Carry-over and owner decisions

- [#2614](https://github.com/akoita/resonate/issues/2614) stays open, with no milestone: the inverse pitch/tempo detector stage, the false-positive run on 1,000+ real catalog tracks, and the robustness re-run on 20+ real renders. The last item was the one thing left on #2573.
- The parent [#2566](https://github.com/akoita/resonate/issues/2566) stays open until #2614 lands.
