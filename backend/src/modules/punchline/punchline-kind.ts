/**
 * Golden Moments kinds (#1476 slice 2).
 *
 * A moment's kind is a presentation skin: it names the moment the way its
 * genre does and drives card and copy flavour. It changes nothing about the
 * rights class, the price band or the clip mechanics. "Drop" is never a kind:
 * it already names the collection. Pure; no I/O.
 */

export const PUNCHLINE_MOMENT_KINDS = [
  "punchline",
  "crescendo",
  "hook",
  "solo",
] as const;

export type PunchlineMomentKind = (typeof PUNCHLINE_MOMENT_KINDS)[number];

/** The pre-#1476 kind of every stored moment (the column default). */
export const PUNCHLINE_DEFAULT_MOMENT_KIND: PunchlineMomentKind = "punchline";

export function isPunchlineMomentKind(value: unknown): value is PunchlineMomentKind {
  return (
    typeof value === "string" &&
    (PUNCHLINE_MOMENT_KINDS as readonly string[]).includes(value)
  );
}

// Genre keywords, matched as substrings of the lower-cased release genre.
const CRESCENDO_GENRES = [
  "classical",
  "orchestral",
  "cinematic",
  "soundtrack",
  "score",
  "epic",
  "ambient",
  "post-rock",
];
const SOLO_GENRES = ["jazz", "blues", "rock", "metal", "funk", "fusion"];
const PUNCHLINE_GENRES = ["hip-hop", "hip hop", "hiphop", "rap", "drill", "grime", "trap"];

/**
 * The kind a new moment defaults to from its release genre. Rap → Punchline,
 * orchestral/cinematic → Crescendo, jazz/rock/blues → Solo, anything else
 * (pop, electronic, unknown) → Hook. The artist can always change it.
 */
export function defaultMomentKindForGenre(
  genre: string | null | undefined,
): PunchlineMomentKind {
  const g = (genre ?? "").trim().toLowerCase();
  if (!g) return PUNCHLINE_DEFAULT_MOMENT_KIND;
  if (PUNCHLINE_GENRES.some((k) => g.includes(k))) return "punchline";
  if (CRESCENDO_GENRES.some((k) => g.includes(k))) return "crescendo";
  if (SOLO_GENRES.some((k) => g.includes(k))) return "solo";
  return "hook";
}
