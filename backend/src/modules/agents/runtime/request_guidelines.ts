import type { AgentRequestScope } from "../agent_session_request";

/**
 * The request guideline (#2316). A request that names a genre decides which
 * tracks are eligible: the model stops when matching tracks run out, unless the
 * listener allowed similar sounds. Without such a request the Genres list is the
 * listener's taste and guides the search.
 */
export function requestGuidelines(scope?: AgentRequestScope): string[] {
  if (scope?.gated) {
    return [
      "- Requested genres, Mood/Moods, Energy and Tempo are what the listener asked for in this session. The requested genres decide which tracks are eligible: choose only tracks that match them, ranked by how well they also fit the mood, energy and tempo.",
      scope.fillSimilar
        ? "- The listener allowed similar sounds (Widening: on). Only after every matching track, you may add closely related styles."
        : "- When the matching tracks run out, stop and return fewer tracks. Never fill the remaining slots with other genres.",
    ];
  }
  return [
    "- Requested genres, Mood/Moods, Energy and Tempo are what the listener asked for in this session: rank tracks that match them above tracks that only match the broader Genres list (their saved vibes and learned taste).",
  ];
}
