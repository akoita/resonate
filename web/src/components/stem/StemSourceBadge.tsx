"use client";

import {
  STEM_SOURCE_LABELS,
  stemSourceTitle,
  type StemSource,
} from "../../lib/stemSource";

interface StemSourceBadgeProps {
  source: StemSource | null | undefined;
  separationModel?: string | null;
  className?: string;
}

/**
 * "Official" (the artist's lossless parts) or "Separated (AI)" next to a stem
 * wherever it is sold (#1976). Renders nothing for a full-mix row.
 */
export function StemSourceBadge({ source, separationModel, className }: StemSourceBadgeProps) {
  if (!source) return null;
  return (
    <span
      className={`stem-source-badge stem-source-badge--${source}${className ? ` ${className}` : ""}`}
      data-source={source}
      title={stemSourceTitle(source, separationModel)}
    >
      {STEM_SOURCE_LABELS[source]}
    </span>
  );
}
