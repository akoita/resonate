# Vision Sprint 54: Traceable remixes

**Status:** 🟡 Approved by the owner and started on 2026-11-04.
**Milestone:** [Vision Sprint 54](https://github.com/akoita/resonate/milestone/52).
Each item is a sub-issue of #2566, so the milestone can close when the
feature works end to end.
**Goal:** Every remix render (master, rendered stems, DJ extended) carries an
inaudible watermark that a Resonate admin can read back from a clip found
elsewhere and attach to a dispute, and creators are told this before they
export.

## Why this theme

- **Mashups raised the stakes.** Sprint 53 put two artists' stems into one
  exportable remix. Licensing is enforced for everything that goes through
  Resonate, but nothing in an exported file, or in a recorded studio
  playback, ties a copy found later back to the render it came from.
- **The design is written.** #2566 covers why SynthID can't do this (no
  third-party embedding, no payload), the candidate schemes, where the mark
  goes in the pipeline, the token table and the acceptance criteria.
- **No owner gate blocks it.** Unlike #2379 (data-gated), #2367 (owner
  design decision), #2154 (owner passkey) and live charging (#2409), every
  slice here can be built and verified on staging. The only owner step is the
  key secret write in resonate-iac#333.

## Scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | Technical | [#2572](https://github.com/akoita/resonate/issues/2572) (#2566 slice 1, spike) | Test set of remix drafts and mashups across genres. Attack set: MP3 128/64 kbit/s, AAC 128 kbit/s, 44.1↔48 kHz, -14 LUFS, ±5% speed, ±2 semitones, 30 s excerpts, mixed under other music at -6 dB. audiowmark vs AudioSeal (WavMark optional): payload recovery, false positives on ≥1,000 unwatermarked catalog tracks, cost per minute of audio, blind A/B listening check. Decision and GPLv3 separate-process note in `docs/rfc/remix-watermarking.md` |
| 2 | P0 | User feature | [#2573](https://github.com/akoita/resonate/issues/2573) (#2566 slice 2, embed) | `StemAudioMixer` embeds an opaque 128-bit token on the PCM mix before the final encode, behind a config flag. `RemixRenderWatermark` table (Prisma migration) maps the token to project, job, owner, sources, stems, licence proof, policy and key ID. Render metadata records scheme and version, or `watermark: none` when no key is set. Parity tests: preview still matches within tolerance; DJ extended and the stems zip keep a readable mark |
| 3 | P0 | User feature | [#2574](https://github.com/akoita/resonate/issues/2574) (#2566 slice 4, disclosure) | Licence templates, the studio export panel, the in-app Remix guide, `docs/features/remix_studio.md` and `docs/features/README.md` say renders carry an inaudible Resonate watermark that identifies the project. Ships in the same release as slice 2 |
| 4 | P1 | User feature | [#2575](https://github.com/akoita/resonate/issues/2575) (#2566 slice 3, detect) | Admin-only detect action on an uploaded clip, tried with the active and retired keys, returning the matching record and a bit-error figure. The result attaches as typed evidence to the rights evidence and dispute flow (#471, #476), with copy that says a token proves which render, not who uploaded it |
| 5 | P2 | Technical | [#2576](https://github.com/akoita/resonate/issues/2576) (for #347) | Confirm whether the Vertex `synthid-audio:verify` endpoint that `synthid.service.ts` calls is real and documented, and record the answer on #347 |

**Spike result (#2572):** audiowmark 0.6.5 at strength 15, run as a separate
process, with an inverse pitch/tempo search in the detector. Measurements,
GPLv3 note and the hand-off to #2573 and resonate-iac#333 are in
[`docs/rfc/remix-watermarking.md`](../rfc/remix-watermarking.md). The blind
listening check is still open for the owner.

Deployment half: [resonate-iac#333](https://github.com/akoita/resonate-iac/issues/333)
(key secret per environment with a retired key slot, the embedder/detector in
the backend image or a worker image, env var wired into both apply
workflows). The operator runs the secret write.

## Owner decisions (from #2566)

Accepted by the owner as recommended on 2026-11-04 (recorded on #2566):

1. **Account erasure:** keep the token row with the owner pseudonymised, since
   evidence of a licence breach outlives the account. Fits the existing
   erasure path.
2. **AI-only drafts:** mark them too. Same pipeline, and it helps with
   AI-disclosure claims.
3. **Plan gating:** none. Watermarking is free on every tier, because it
   protects the source artists, not the creator.

## Exit criteria

- The spike's pick recovers the token from ≥95% of 30-second excerpts after
  the attack set at 128 kbit/s, with no false positive on the unwatermarked
  set and no audible difference in the blind check.
- Slices 2–4 merged with focused backend and web tests, including the
  preview parity and export-survival tests.
- A missing key or a detector failure never blocks a render, publish or
  export.
- New config documented in `docs/deployment/environment.md`; licence and
  User Guide copy disclose the watermark.
- resonate-iac#333 applied on staging, a staging render detected from an
  MP3 excerpt, milestone closed.

## Not in this sprint

- Automated scanning of other platforms and DMCA notices (#409)
- SynthID verification on upload (#347 build), beyond the endpoint check
- Fingerprinting (#405, #408)

## Revenue line

ADR-BM-6: vision-neutral rights-protection infrastructure. It protects the
licensing revenue that remix licences feed (line 3, marketplace take-rate;
line 5, B2B/agent licensing). No fee, price, split or payout changes, and
ADR-BM-4 is untouched.
