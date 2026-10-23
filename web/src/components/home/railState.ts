/*
 * Load state of one Home rail (#2228). Kept in its own tiny module (no
 * component imports) so page.tsx can use the constants without pulling the
 * lazily loaded rail components into the main bundle.
 */
export type RailState<T> =
  | { status: "loading" }
  | { status: "ready"; items: T[] }
  | { status: "error" };

export const RAIL_LOADING: { status: "loading" } = { status: "loading" };
export const RAIL_ERROR: { status: "error" } = { status: "error" };
