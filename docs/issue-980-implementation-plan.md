# Issue 980 Implementation Plan

Issue: [#980](https://github.com/akoita/resonate/issues/980)

## Goal

Make Session Intent, mood/vibe, and listener outcome context available to the
AI DJ learning loop through bounded `AgentSignal` metadata.

## Scope

1. Add a stable `agent-signal-metadata/v1` metadata builder for session context
   and outcome context.
2. Extend signal actions with `complete` and `save` so playback completion and
   library saves can be represented directly.
3. Record Session Intent context for AI DJ first picks, Next Pick requests, and
   purchase signals.
4. Mirror authenticated playback completions and library/playlist product
   events into AgentSignal when track context exists.
5. Annotate session signals with coarse session duration when an AI DJ session
   stops.
6. Update analytics taxonomy, feature docs, and integration/unit tests.

## Privacy Rules

Signal metadata can include stable categories, bounded strings, numeric outcome
values, and compact recommendation summaries. It must not include raw listening
history, wallet addresses, emails, URLs, exact location, auth/session secrets,
or unbounded free-form user text.

## Verification

- Unit tests for metadata sanitization and weighted aggregation.
- Analytics instrumentation tests for playback/save mirroring.
- HTTP contract coverage for AI DJ Session Intent product events.
- Prisma-backed integration coverage for recording and session-outcome
  annotation.
