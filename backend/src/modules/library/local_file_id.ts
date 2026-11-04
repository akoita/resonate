/**
 * Device files carry client ids of the form `local_<time>_<random>` (web
 * `localLibrary.saveTrack`; `LibraryService` enforces the prefix). Code that
 * only holds an id uses this to keep a listener's own file out of analytics,
 * taste signals and catalog lookups (#2507).
 */
export const LOCAL_FILE_ID_PREFIX = "local_";

export function isLocalFileClientId(value: unknown): boolean {
  return typeof value === "string" && value.trim().startsWith(LOCAL_FILE_ID_PREFIX);
}
