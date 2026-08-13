"use client";

interface VolumeIconProps {
  volume: number;
  muted: boolean;
  size?: number;
}

/**
 * Speaker glyph whose waves track the actual level, replacing the 🔇/🔉/🔊
 * emoji. Emoji ignore `currentColor` (so the control's hover and focus states
 * were invisible), render at a different weight than every other icon in the
 * player bar, and change shape per operating system. This draws in the same
 * stroke vocabulary as the transport controls beside it, and the waves fade
 * in and out as the slider moves.
 */
export function VolumeIcon({ volume, muted, size = 16 }: VolumeIconProps) {
  const level = muted ? 0 : Math.min(1, Math.max(0, volume));

  return (
    <svg
      className={`volume-glyph ${muted ? "is-muted" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none" />
      <path className="volume-glyph__wave" d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4" opacity={level > 0.02 ? 1 : 0} />
      <path className="volume-glyph__wave" d="M18.6 5.7a9 9 0 0 1 0 12.6" opacity={level > 0.55 ? 1 : 0} />
      <line className="volume-glyph__slash" x1="15.5" y1="9" x2="21.5" y2="15" opacity={muted ? 1 : 0} />
      <line className="volume-glyph__slash" x1="21.5" y1="9" x2="15.5" y2="15" opacity={muted ? 1 : 0} />
    </svg>
  );
}
