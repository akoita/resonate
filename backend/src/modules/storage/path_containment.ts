import { resolve, sep } from "path";

/**
 * Resolves `candidate` against `baseDir` and returns the absolute path only
 * when it stays inside `baseDir`; otherwise null.
 *
 * Sweep finding from the #1189 review: several upload-directory reads and
 * writes joined DB-sourced or worker-message-sourced relative paths without
 * containment, so a traversal-shaped value (`../../...`) escaped the
 * directory. Those values are server-written today — this is defense in
 * depth at the file-system boundary, applied wherever a stored or
 * cross-service path meets `join(uploadsDir, ...)`.
 */
export function resolveContainedPath(
  baseDir: string,
  candidate: string,
): string | null {
  if (!candidate) return null;
  const base = resolve(baseDir);
  const resolved = resolve(base, candidate);
  return resolved.startsWith(base + sep) ? resolved : null;
}
