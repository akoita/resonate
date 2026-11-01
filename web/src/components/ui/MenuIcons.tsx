import type { ReactNode } from "react";

/**
 * Line icons for context and overflow menus.
 *
 * Menus used to pass emoji as icons. Emoji render as full-colour tiles whose
 * look depends on the operating system (pale blue squares on Windows), so
 * they clashed with the dark theme and with each other. These glyphs share
 * one stroke weight and inherit `currentColor`, so they follow the menu
 * item's text colour through hover, focus and the destructive variant.
 */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function PlayIcon() {
  return (
    <Glyph>
      <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function PlayNextIcon() {
  return (
    <Glyph>
      <polygon points="4 5 13 12 4 19 4 5" fill="currentColor" stroke="none" />
      <line x1="18" y1="6" x2="18" y2="18" />
    </Glyph>
  );
}

export function AddToQueueIcon() {
  return (
    <Glyph>
      <line x1="3" y1="6" x2="14" y2="6" />
      <line x1="3" y1="12" x2="14" y2="12" />
      <line x1="3" y1="18" x2="10" y2="18" />
      <line x1="18" y1="11" x2="18" y2="21" />
      <line x1="13" y1="16" x2="23" y2="16" />
    </Glyph>
  );
}

export function RepeatIcon() {
  return (
    <Glyph>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </Glyph>
  );
}

export function AddToPlaylistIcon() {
  return (
    <Glyph>
      <path d="M9 18V5l11-2v8" />
      <circle cx="6" cy="18" r="3" />
      <line x1="18" y1="15" x2="18" y2="22" />
      <line x1="14.5" y1="18.5" x2="21.5" y2="18.5" />
    </Glyph>
  );
}

export function RenameIcon() {
  return (
    <Glyph>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Glyph>
  );
}

export function DeleteIcon() {
  return (
    <Glyph>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Glyph>
  );
}

export function RemoveIcon() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </Glyph>
  );
}

export function DownloadIcon() {
  return (
    <Glyph>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </Glyph>
  );
}

export function SellIcon() {
  return (
    <Glyph>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function InfoIcon() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="16" x2="12" y2="11" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </Glyph>
  );
}

export function StemsIcon() {
  return (
    <Glyph>
      <line x1="6" y1="3" x2="6" y2="21" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="18" y1="3" x2="18" y2="21" />
      <rect x="4" y="13" width="4" height="3" rx="1" fill="currentColor" />
      <rect x="10" y="6" width="4" height="3" rx="1" fill="currentColor" />
      <rect x="16" y="11" width="4" height="3" rx="1" fill="currentColor" />
    </Glyph>
  );
}
