import type { CSSProperties } from "react";
import type { TrackDescriptor } from "../../lib/api";

export type TrackDescriptorTagsProps = {
  descriptor?: TrackDescriptor | null;
};

const TEMPO_LABEL: Record<NonNullable<TrackDescriptor["tempoBand"]>, string> = {
  slow: "Slow tempo",
  mid: "Medium tempo",
  fast: "Fast tempo",
};

const ENERGY_LABEL: Record<NonNullable<TrackDescriptor["energyBand"]>, string> = {
  low: "Low energy",
  medium: "Medium energy",
  high: "High energy",
};

const VOCAL_LABEL: Record<NonNullable<TrackDescriptor["vocal"]>, string> = {
  vocal: "Vocals",
  instrumental: "Instrumental",
};

/** The suggested tags of a track, in reading order: families, styles, then sound. */
export function trackDescriptorTagLabels(descriptor?: TrackDescriptor | null): string[] {
  if (!descriptor) return [];
  return [
    ...descriptor.familyLabels,
    ...descriptor.subGenres,
    ...(descriptor.tempoBand ? [TEMPO_LABEL[descriptor.tempoBand]] : []),
    ...(descriptor.energyBand ? [ENERGY_LABEL[descriptor.energyBand]] : []),
    ...(descriptor.vocal ? [VOCAL_LABEL[descriptor.vocal]] : []),
  ].filter(Boolean);
}

const chipStyle: CSSProperties = {
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: 12,
  fontSize: 11,
  color: "#d4d4d8",
  background: "rgba(255, 255, 255, 0.06)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
};

/**
 * Read-only tags Resonate suggested for a track (#2240). There is nothing to
 * click or edit: artist corrections are a later change (#2292). Renders nothing
 * when the track has no tags. Tag text is plain text (React escapes it).
 */
export function TrackDescriptorTags({ descriptor }: TrackDescriptorTagsProps) {
  const labels = trackDescriptorTagLabels(descriptor);
  if (labels.length === 0) return null;
  return (
    <div
      className="track-descriptor-tags"
      data-testid="track-descriptor-tags"
      style={{ marginTop: 5 }}
      onClick={(event) => event.stopPropagation()}
    >
      <ul
        aria-label="Suggested tags"
        style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: 0, padding: 0, listStyle: "none" }}
      >
        {labels.map((label, index) => (
          <li key={`${label}:${index}`} style={chipStyle}>
            {label}
          </li>
        ))}
      </ul>
      <p style={{ margin: "3px 0 0", fontSize: 11, color: "#a1a1aa" }}>
        Suggested by Resonate from your track&apos;s details and sound
      </p>
    </div>
  );
}
