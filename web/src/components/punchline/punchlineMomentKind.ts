/**
 * Golden Moments kinds (#1476 slice 2): a presentation skin that names a
 * moment the way its genre does. Mirrors backend punchline-kind.ts. "Drop" is
 * never a kind: it already names the collection.
 */

export const MOMENT_KINDS = ["punchline", "crescendo", "hook", "solo"] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

export const DEFAULT_MOMENT_KIND: MomentKind = "punchline";

type KindCopy = {
  label: string;
  /** One line for the builder picker. */
  hint: string;
  /** Badge glyph on the card. */
  glyph: string;
};

export const MOMENT_KIND_COPY: Readonly<Record<MomentKind, KindCopy>> = {
  punchline: { label: "Punchline", hint: "The line fans quote back (rap, hip-hop).", glyph: "🎤" },
  crescendo: { label: "Crescendo", hint: "The swell where the arrangement peaks (orchestral, cinematic).", glyph: "🎻" },
  hook: { label: "Hook", hint: "The part everyone sings along to.", glyph: "🎶" },
  solo: { label: "Solo", hint: "An instrument's standout passage (rock, jazz, blues).", glyph: "🎸" },
};

export function normalizeMomentKind(value: string | null | undefined): MomentKind {
  const key = value?.trim().toLowerCase() ?? "";
  return (MOMENT_KINDS as readonly string[]).includes(key)
    ? (key as MomentKind)
    : DEFAULT_MOMENT_KIND;
}

export function momentKindLabel(value: string | null | undefined): string {
  return MOMENT_KIND_COPY[normalizeMomentKind(value)].label;
}

export function momentKindGlyph(value: string | null | undefined): string {
  return MOMENT_KIND_COPY[normalizeMomentKind(value)].glyph;
}
