/**
 * The inventory of every path on which audio that can contain AI-generated
 * sound is stored or leaves Resonate (#2602).
 *
 * Generated audio must be marked in a machine-readable way. This list is the
 * single place that says, for each path, whether generated audio can be in
 * it and how it is marked. `generated-audio-outputs.spec.ts` fails when a
 * source file in the remix or generation modules stores audio, or a remix
 * route sends audio, without being listed here, and when the table in
 * `docs/features/remix_studio.md` misses an entry. A new path cannot ship
 * unlisted.
 *
 * "Remix mark" is the inaudible audiowmark token of #2573. It is embedded
 * only where a watermark key is configured; without a key nothing is marked
 * and nothing is refused.
 */
export type GeneratedAudioMarking =
  /** The remix mark; with a key, the output fails instead of shipping unmarked. */
  | "remix_mark_required"
  /** The provider marks its own output and declares it (`synthIdPresent`). */
  | "provider_mark"
  /** File tags only; the audio never leaves except inside a marked render. */
  | "file_tags"
  /** A byte copy or re-encode of a draft, refused when that draft is unmarked. */
  | "inherits_draft_mark"
  /** Owner-only playback inside the studio of audio covered by another row. */
  | "studio_playback";

export type GeneratedAudioOutputPath = {
  id: string;
  /** What the path is, in plain words. */
  what: string;
  /** Source file under `backend/src/modules` that stores or sends it. */
  source: string;
  /** Storage writes (`upload` calls) this path makes in `source`. */
  uploads: number;
  /** Audio responses the remix controller sends for this path. */
  routes: string[];
  marking: GeneratedAudioMarking;
  /** How it is marked, in one sentence. */
  how: string;
};

export const GENERATED_AUDIO_OUTPUT_PATHS: readonly GeneratedAudioOutputPath[] = [
  {
    id: "stem-mix-draft",
    what: "Mix stems draft (can hold AI parts)",
    source: "remix/remix-stem-mix.renderer.ts",
    uploads: 1,
    routes: [],
    marking: "remix_mark_required",
    how: "Remix mark on the master. A render with an AI part fails if the mark cannot be embedded; a render with no generated audio ships unmarked on failure.",
  },
  {
    id: "stem-mix-stems",
    what: "Stems rendered with a draft (can hold AI part stems)",
    source: "remix/remix-stem-mix.renderer.ts",
    uploads: 1,
    routes: [],
    marking: "remix_mark_required",
    how: "The draft's token in every stem file. A stem that is an AI part fails the render if it cannot be marked.",
  },
  {
    id: "layered-draft",
    what: "Stems plus a generated layer",
    source: "remix/remix-layered-renderer.ts",
    uploads: 1,
    routes: [],
    marking: "remix_mark_required",
    how: "Remix mark on the master; the render fails if the mark cannot be embedded.",
  },
  {
    id: "audio-conditioned-draft",
    what: "Draft returned whole by the audio-conditioned model",
    source: "remix/audio-conditioned-remix-generation.provider.ts",
    uploads: 1,
    routes: [],
    marking: "remix_mark_required",
    how: "Marked before it is stored (`markGeneratedAudio`); the draft fails if the mark cannot be embedded.",
  },
  {
    id: "provider-draft",
    what: "Draft or layer returned whole by the Lyria provider",
    source: "remix/lyria-remix-generation.provider.ts",
    uploads: 1,
    routes: [],
    marking: "provider_mark",
    how: "The provider embeds its own mark and the draft records `synthIdPresent`. Used as a layer, the finished mix is the layered draft above.",
  },
  {
    id: "ai-part-take",
    what: "AI part take (one instrument, 4 or 8 bars)",
    source: "remix/remix-project.service.ts",
    uploads: 1,
    routes: ["GET /remix/projects/:id/parts/takes/:takeId/audio"],
    marking: "file_tags",
    how: "The FLAC carries `AI_GENERATED` and the IPTC digital source type tags. The owner auditions it in the studio; it leaves only inside a render, which carries the remix mark.",
  },
  {
    id: "published-remix",
    what: "Published remix audio",
    source: "remix/remix-project.service.ts",
    uploads: 1,
    routes: [],
    marking: "inherits_draft_mark",
    how: "A byte copy of the draft. Publishing an AI draft that is not marked is refused (`draft_unmarked`).",
  },
  {
    id: "draft-export",
    what: "Export audio, DJ extended export and stems export",
    source: "remix/remix-project.service.ts",
    uploads: 0,
    routes: ["POST /remix/projects/:id/export", "POST /remix/projects/:id/export (stems)"],
    marking: "inherits_draft_mark",
    how: "The draft's own bytes, a re-encode of them, or its marked stems. Exporting an AI draft that is not marked is refused (`draft_unmarked`). The DJ sidecar and the stems manifest carry the AI disclosure.",
  },
  {
    id: "draft-playback",
    what: "Draft playback in the studio",
    source: "remix/remix-project.service.ts",
    uploads: 0,
    routes: ["GET /remix/projects/:id/draft-audio"],
    marking: "studio_playback",
    how: "Owner-only stream of a draft covered by the rows above; no download.",
  },
  {
    id: "standalone-generation",
    what: "Track generated outside the remix studio",
    source: "generation/generation.service.ts",
    uploads: 1,
    routes: [],
    marking: "provider_mark",
    how: "The provider embeds its own mark; the track records `synthIdPresent` and its AI disclosure.",
  },
];
