/**
 * The genres an AI DJ session searches, in priority order: the listener's
 * learned favorites, then their saved vibes (`AgentConfig.vibes`), then the
 * genres this session asked for (a preset's genres or the picker's choice).
 * Deduped by exact value; empty values dropped. Pure: it never writes
 * `AgentConfig.vibes`, so a session's genres do not become saved vibes.
 */
export function mergeSessionGenres(input: {
  learnedGenres?: readonly string[];
  vibes?: readonly string[];
  sessionGenres?: readonly string[];
}): string[] {
  return Array.from(
    new Set(
      [
        ...(input.learnedGenres ?? []),
        ...(input.vibes ?? []),
        ...(input.sessionGenres ?? []),
      ].filter(Boolean),
    ),
  );
}
