/**
 * Declared vs. listening taste (#2101, docs/rfc/declared-vs-listening-taste.md).
 *
 * Pure helpers: no database, no module imports beyond types, so Home and Taste
 * Memory share one definition of "listening genre" and "stale boost" without a
 * module cycle with the learning service.
 *
 * Declared boosts never fade (ADR-TE-5): staleness is only surfaced.
 */

/** Learned profile needs at least this many positive signals to count. */
export const LISTENING_MIN_POSITIVE_SIGNALS = 5;
/** A boost younger than this is never reported as stale. */
export const STALE_BOOST_MIN_AGE_DAYS = 14;
/** A boost is stale only when its value is outside this many top learned labels. */
const STALE_BOOST_TOP_LEARNED = 5;
/** How many "listening elsewhere" labels the hint may offer. */
const LISTENING_LABELS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The slice of the learned taste profile these helpers read. */
export interface LearnedTasteView {
  positiveSignals: number;
  genreWeights: Record<string, number>;
  moodWeights?: Record<string, number>;
}

/** The slice of a taste control these helpers read. */
export interface TasteControlView {
  id: string;
  signalType: string;
  value: string;
  action: string;
  createdAt: string;
}

export interface StaleBoost {
  controlId: string;
  signalType: "genre" | "mood";
  value: string;
  /** ISO timestamp of the boost control. */
  boostedAt: string;
}

export interface TasteDrift {
  staleBoosts: StaleBoost[];
  /** Top learned genres (up to 3) not boosted, downranked or hidden. */
  listeningGenres: string[];
  /** Top learned moods (up to 3) not boosted, downranked or hidden. */
  listeningMoods: string[];
}

const key = (value: string) => value.trim().toLowerCase();

/** Positive finite weights, highest first, ties broken by label. */
export function topLearned(
  weights: Record<string, number> | undefined,
  n: number,
): string[] {
  return Object.entries(weights ?? {})
    .filter(([label, weight]) => label.trim() && Number.isFinite(weight) && weight > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, n))
    .map(([label]) => label);
}

/**
 * The learned top genre when it is not one the listener already declared;
 * null below the evidence floor or when listening agrees with declared taste.
 * Genres the listener asked for less of are skipped: declared outranks
 * behavioral (ADR-TE-5).
 */
export function listeningGenre(
  profile: Pick<LearnedTasteView, "positiveSignals" | "genreWeights"> | null | undefined,
  declaredGenres: string[],
  downrankedGenres: Iterable<string> = [],
): string | null {
  if (!profile || profile.positiveSignals < LISTENING_MIN_POSITIVE_SIGNALS) return null;
  const downranked = new Set([...downrankedGenres].map(key));
  const [top] = topLearned(profile.genreWeights, Number.MAX_SAFE_INTEGER)
    .filter((label) => !downranked.has(key(label)));
  if (!top) return null;
  const declared = new Set(declaredGenres.map(key));
  return declared.has(key(top)) ? null : top;
}

/**
 * Boosted genres/moods created at least 14 days ago that the listener no
 * longer plays, plus what they play instead. Null when there is nothing to say.
 */
export function computeTasteDrift(input: {
  profile: LearnedTasteView;
  controls: TasteControlView[];
  now: Date;
}): TasteDrift | null {
  const { profile, controls, now } = input;
  if (profile.positiveSignals < LISTENING_MIN_POSITIVE_SIGNALS) return null;

  const cutoff = now.getTime() - STALE_BOOST_MIN_AGE_DAYS * DAY_MS;
  const topGenres = new Set(topLearned(profile.genreWeights, STALE_BOOST_TOP_LEARNED).map(key));
  const topMoods = new Set(topLearned(profile.moodWeights, STALE_BOOST_TOP_LEARNED).map(key));

  const boosts = controls.filter(
    (control): control is TasteControlView & { signalType: "genre" | "mood" } =>
      control.action === "boosted" &&
      (control.signalType === "genre" || control.signalType === "mood"),
  );

  const staleBoosts: StaleBoost[] = boosts
    .filter((control) => {
      const boostedAt = Date.parse(control.createdAt);
      if (!Number.isFinite(boostedAt) || boostedAt > cutoff) return false;
      const top = control.signalType === "genre" ? topGenres : topMoods;
      return !top.has(key(control.value));
    })
    .map((control) => ({
      controlId: control.id,
      signalType: control.signalType,
      value: control.value,
      boostedAt: control.createdAt,
    }));
  if (!staleBoosts.length) return null;

  // Never suggest "more" of something already boosted, or of something the
  // listener asked for less of or hid (declared outranks behavioral).
  const claimedOf = (type: "genre" | "mood") =>
    new Set(
      controls
        .filter(
          (control) =>
            control.signalType === type &&
            (control.action === "boosted" || control.action === "downranked" || control.action === "hidden"),
        )
        .map((control) => key(control.value)),
    );
  const claimedGenres = claimedOf("genre");
  const claimedMoods = claimedOf("mood");

  return {
    staleBoosts,
    listeningGenres: topLearned(profile.genreWeights, Number.MAX_SAFE_INTEGER)
      .filter((label) => !claimedGenres.has(key(label)))
      .slice(0, LISTENING_LABELS),
    listeningMoods: topLearned(profile.moodWeights, Number.MAX_SAFE_INTEGER)
      .filter((label) => !claimedMoods.has(key(label)))
      .slice(0, LISTENING_LABELS),
  };
}
