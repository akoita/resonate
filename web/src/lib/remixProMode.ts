/**
 * Remix Studio Pro switch (#1903 S6a): whether THIS device shows the
 * engineer tools (per-stem EQ and pan). A view preference only — it never
 * changes the remix, and saved Pro settings keep playing and rendering with
 * the switch off. Off by default; remembered in localStorage, and every
 * storage access fails silently. Whether the switch is offered at all comes
 * from the server (`project.entitlements.pro.allowed`); Pro is free for now.
 */

import type { RemixProject } from "./api";

export const PRO_MODE_STORAGE_KEY = "resonate.remixStudio.proMode";

/** The switch's tooltip. */
export const PRO_MODE_TOOLTIP = "Show engineer tools: per-stem EQ and pan";

/** The lane badge shown for saved Pro settings while the switch is off. */
export const PRO_BADGE_LABEL = "Pro EQ/pan active — turn on Pro to edit";

type ProStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): ProStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The remembered switch; off when unavailable, unset or corrupt. */
export function readProMode(storage: ProStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(PRO_MODE_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

/** Remembers the switch; a no-op when storage is unavailable or full. */
export function writeProMode(
  on: boolean,
  storage: ProStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PRO_MODE_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Convenience only: the page works without storage.
  }
}

/** Whether the server offers Pro mode on this project (never hard-coded). */
export function proModeAllowed(project: Pick<RemixProject, "entitlements">): boolean {
  return project.entitlements?.pro?.allowed === true;
}
