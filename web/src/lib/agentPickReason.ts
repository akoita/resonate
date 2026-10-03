/**
 * Plain words for an AI DJ pick that came back empty (#2056). The backend's
 * selector reason says whether nothing in the catalog matches the session's
 * filters (the gap is recorded as demand, ADR-TE-4) or whether every matching
 * track has already played; the raw status code is never shown.
 */
const NO_MATCH_REASONS = new Set(["no_matching_taste_candidates", "empty_catalog"]);

export function humanPickReason(status?: string, reason?: string): string {
  if (status === "no_tracks") {
    return reason && NO_MATCH_REASONS.has(reason)
      ? "Nothing in the catalog matches this session's filters yet. Try other filters or another quick start."
      : "You've heard everything that fits this session. Try other filters or another quick start.";
  }
  if (status === "all_rejected") return "Matching tracks were found, but none passed the DJ's policy checks.";
  if (reason === "no_matching_taste_candidates") return "No catalog candidates matched the selected vibes.";
  return reason ? reason.replace(/_/g, " ") : "No runtime pick returned.";
}
