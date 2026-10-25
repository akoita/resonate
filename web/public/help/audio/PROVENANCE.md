# Provenance of the User Guide audio examples

The audio in this folder is **project-generated**. No catalog audio, no
recordings, no samples, loops or sound libraries, no downloaded files and no
AI model or paid API were used.

- **Licence:** project-generated, no third-party audio; released under this
  repository's licence.
- **Source song:** "Resonate Help Demo", a 32-second, 180 BPM (half-time feel),
  A minor song synthesized sample by sample (sine/saw/noise arithmetic and
  envelopes with fixed seeds) as four stems: a wordless synthesized voice,
  drums, bass, and chords. Generator: `backend/scripts/help-audio/demo-song.ts`.
- **Clips:** rendered from those stems through the Remix Studio's own render
  graph (`buildStemMixFfmpegArgs` in
  `backend/src/modules/remix/stem-audio-mixer.ts`), with the recipes the
  studio's controls produce (the Slowed + reverb vibe and Short edit come from
  `web/src/lib/remixFx.ts` and `web/src/lib/remixStructure.ts`), under the
  studio's loudness policy (`remix-render-policy/v1`, -14 LUFS). The only
  difference from a studio draft is the output bitrate (128 kbps MP3 instead of
  320 kbps) to keep the guide light.
- **The bass example** is not an AI take. Its bass part comes from the studio's
  deterministic stub generator (`backend/src/modules/remix/remix-part-stub-clip.ts`),
  run through the same prompt, conform, loop and placement steps as a real take.
  The guide says so next to the clip.
- **Regenerate:** `npm run help:audio` in `backend/` (needs `ffmpeg` >= 7; no
  network). The same inputs give the same synthesized stems; the MP3 bytes can
  differ between ffmpeg builds. See `docs/features/user_manual.md`.
- **Record of the last run:** `manifest.json` in this folder (script paths,
  stem hashes, per-clip duration, loudness, true peak, recipe, tool versions).
- **Generated on:** 2026-10-25 (issue #1943).
