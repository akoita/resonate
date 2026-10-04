import type { AgentMixCoverage } from "./api";
import { myMixCoverageNotes } from "./agentMyMix";

/**
 * Plain words for an AI DJ pick that came back empty (#2056). The backend's
 * selector reason says whether nothing in the catalog matches the session's
 * filters (the gap is recorded as demand, ADR-TE-4) or whether every matching
 * track has already played; the raw status code is never shown.
 */
const NO_MATCH_REASONS = new Set(["no_matching_taste_candidates", "empty_catalog"]);

export function humanPickReason(
  status?: string,
  reason?: string,
  mixCoverage?: AgentMixCoverage | null,
): string {
  const mixNotes = myMixCoverageNotes(mixCoverage);
  if (status === "no_tracks") {
    if (mixNotes.length > 0) return mixNotes.join(" ");
    return reason && NO_MATCH_REASONS.has(reason)
      ? "Nothing in the catalog matches this session's filters yet. Try other filters or another quick start."
      : "You've heard everything that fits this session. Try other filters or another quick start.";
  }
  const reasonText = status === "all_rejected"
    ? "Matching tracks were found, but none passed the DJ's policy checks."
    : reason === "no_matching_taste_candidates"
      ? "No catalog candidates matched the selected vibes."
      : reason ? reason.replace(/_/g, " ") : "No runtime pick returned.";
  return mixNotes.length > 0 ? `${reasonText} ${mixNotes.join(" ")}` : reasonText;
}
