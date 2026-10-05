# Declared taste vs. listening on Home

> **Status:** accepted — 2026-10-06, decisions confirmed by @akoita
> ([#2101](https://github.com/akoita/resonate/issues/2101)).
> Builds on [ADR-TE-5](../strategy/taste-engine-decisions.md) and
> [Taste Engine RFC](taste-engine.md).

## Problem

Home has two sources of taste that can disagree:

- **Declared:** genres and moods the listener boosted in Settings → Taste Memory
  (`ListenerTasteSignalControl`, action `boosted`). They never decay.
- **Behavioral:** the learned profile (`resolveAgentTasteProfile`), built from
  plays, replays and saves with a 60-day behavioral half-life, and already used
  to rank Home candidates (`learnedGenreWeights`).

The lead rail "Because you like X" is anchored on the first declared genre
(`HomeFeedService.dominantGenre`). Listening never chooses a rail topic while
anything is declared, and a listener with no declared taste gets no genre rail
at all. Nothing tells the listener that a boost no longer matches what they
play.

## Constraint

ADR-TE-5 orders the layers **commitment > declared > behavioral** and makes the
listener the owner of their profile. Listening may add to Home, but it must not
silently displace or edit a declared choice.

## Decisions

1. **Home adds a listening rail; declared stays first.** When the learned
   profile's top genre is not one of the listener's declared genres, Home adds
   `listening_genre` — "Because you've been playing \<genre\>" — directly after
   `because_genre`. With no declared genre it is the only genre rail, and
   "Trending in \<genre\>" follows the listening genre. The `because_genre` rail
   never takes its topic from listening.
2. **Declared boosts never fade.** A boost is an explicit control and stays
   until the listener changes it. Staleness is surfaced, not acted on.
3. **Settings shows a drift hint, preview-then-apply.** When a boost is at
   least 14 days old and its genre or mood is no longer among the listener's
   top learned ones, Taste Memory says so ("You asked for more jazz, but lately
   you mostly play techno") and offers:
   - "Show more \<listening genre\>": pre-fills the existing preview; nothing is
     stored until the listener presses Apply;
   - "Remove the \<genre\> boost": the same explicit removal the controls list
     already offers.

## Rules

- **Evidence floor:** listening only counts when the learned profile has at
  least 5 positive signals. Below that there is no listening rail and no hint.
- **Listening genre:** the learned genre with the highest positive decayed
  weight, after taste-memory policy (hidden taste, reset, AI DJ training
  opt-out), skipping genres the listener asked for less of. Compared
  case-insensitively with declared genres.
- **Stale boost:** a `boosted` genre or mood control created at least 14 days
  ago whose value is not among the top 5 positive learned genres (or moods).
- **Never "more" of a "less":** a genre or mood the listener downranked or hid
  is never the listening rail's topic and never a "Show more" suggestion.
- **Scope of "declared":** boosts only. Legacy `/recommendations/preferences`
  genres have no web editor and no timestamp, so they anchor rails as before
  but never produce a hint.
- **One ranking call:** the listening genre is passed to the existing
  `getRecommendations` call as an additional preference term, rather than a
  second call that would record extra impressions and duplicate the
  `recommendation.generated` exposure. Home also hands over the learned genre
  weights it already resolved, so the profile is computed once per render.
- **Honest labels:** listening-rail items use the `listening_pattern` reason
  code, and the rail explanation says the topic comes from recent listening and
  fades as listening changes. Explanations stay categorical (RFC §7).

## Out of scope

- Context-specific drift (time of day, weekday) and listening lanes.
- Analytics for hint impressions or acceptance.
- Any change to AI DJ session anchoring, where a session's own genres already
  outrank learned taste (#2059).
