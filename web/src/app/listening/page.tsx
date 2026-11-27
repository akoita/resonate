"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import AuthGate from "../../components/auth/AuthGate";
import { useAuth } from "../../components/auth/AuthProvider";
import { useToast } from "../../components/ui/Toast";
import {
  getListeningStats,
  type ListeningStats,
  type ListeningStatsArtist,
  type ListeningStatsTag,
  type ListeningStatsTrack,
  type ListeningStatsWindow,
} from "../../lib/api";
import {
  changeAgainst,
  formatDay,
  formatListeningTime,
  headlineInsight,
  LISTENING_WINDOW_OPTIONS,
  type LocalDays,
  localDays,
  MOMENT_LABELS,
  MOMENT_ORDER,
  pluralize,
  topMoment,
  trendAxis,
  trendBars,
  windowPhrase,
} from "../../lib/listeningStats";
import { usePlayer } from "../../lib/playerContext";
import { catalogItemToPlayableTrack } from "../../lib/sonicRadarSummary";
import "../../styles/listening-stats.css";

const PLAY_ICON = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
  </svg>
);

const HEART_ICON = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.5 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.5 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" />
  </svg>
);

const LOCK_ICON = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const WINDOW_STORAGE_KEY = "resonate.listening.window";
const noSubscribe = () => () => {};

function readStoredWindow(): ListeningStatsWindow {
  try {
    const stored = Number(window.localStorage.getItem(WINDOW_STORAGE_KEY));
    return LISTENING_WINDOW_OPTIONS.some((option) => option.days === stored) ? (stored as ListeningStatsWindow) : 30;
  } catch {
    return 30;
  }
}

function useListeningStats(days: ListeningStatsWindow | null) {
  const { status, token, sessionChecked } = useAuth();
  const [stats, setStats] = useState<ListeningStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionChecked || status !== "authenticated" || !token || days === null) return;
    setIsLoading(true);
    setError(null);
    try {
      setStats(await getListeningStats(token, { days }));
    } catch {
      setError("We could not load your listening. Try again in a moment.");
    } finally {
      setIsLoading(false);
    }
  }, [days, sessionChecked, status, token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { stats, isLoading, error, retry: load };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** A stable tint per name, so covers without artwork are told apart. */
function tintOf(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `is-tint-${hash % 5}`;
}

function Cover({ src, name, className }: { src: string | null; name: string; className: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`ls-cover ${tintOf(name)} ${className}`} aria-hidden="true">
      {src && !failed ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="ls-cover-fallback">{initials(name) || "♪"}</span>
      )}
    </span>
  );
}

function WindowPicker({ value, onChange }: { value: ListeningStatsWindow; onChange: (days: ListeningStatsWindow) => void }) {
  return (
    <div className="ls-window" role="group" aria-label="Time range">
      {LISTENING_WINDOW_OPTIONS.map((option) => (
        <button
          key={option.days}
          type="button"
          className="ls-window-option"
          aria-pressed={value === option.days}
          onClick={() => onChange(option.days)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Change({ current, previous, noun }: { current: number; previous: number; noun: string }) {
  const change = changeAgainst(current, previous);
  if (!change && current === 0) return null;
  if (!change) return <span className="ls-change is-flat">First {noun} on record</span>;
  if (change.direction === "flat") return <span className="ls-change is-flat">Same as the {noun} before</span>;
  return (
    <span className={`ls-change is-${change.direction}`}>
      <span aria-hidden="true">{change.direction === "up" ? "↑" : "↓"}</span> {change.percent}%{" "}
      <span className="ls-change-note">{change.direction === "up" ? "more" : "less"} than the {noun} before</span>
    </span>
  );
}

function Hero({
  stats,
  local,
  days,
  onDays,
}: {
  stats: ListeningStats | null;
  local: LocalDays | null;
  days: ListeningStatsWindow;
  onDays: (days: ListeningStatsWindow) => void;
}) {
  const time = formatListeningTime(stats?.summary.minutes ?? 0);
  const insight = stats ? headlineInsight(stats) : null;
  const period = days === 7 ? "week" : days === 365 ? "year" : `${days} days`;
  return (
    <section className="ls-hero" aria-labelledby="ls-title">
      <div className="ls-hero-glow" aria-hidden="true" />
      <div className="ls-hero-top">
        <div>
          <p className="ls-kicker">Your listening</p>
          <h1 id="ls-title" className="ls-title">
            Your sound, {windowPhrase(days)}
          </h1>
        </div>
        <WindowPicker value={days} onChange={onDays} />
      </div>
      <div className="ls-hero-body">
        <div className="ls-hero-number">
          <span className="ls-hero-value">
            {time.value}
            <span className="ls-hero-unit"> {time.unit}</span>
          </span>
          <span className="ls-hero-label">listened</span>
          {stats && <Change current={stats.summary.minutes} previous={stats.summary.previous.minutes} noun={period} />}
        </div>
        {insight && <p className="ls-insight">{insight}</p>}
      </div>
      <dl className="ls-tiles">
        <div className="ls-tile">
          <dt>Plays</dt>
          <dd>{(stats?.summary.plays ?? 0).toLocaleString("en")}</dd>
        </div>
        <div className="ls-tile">
          <dt>Tracks</dt>
          <dd>{(stats?.summary.tracks ?? 0).toLocaleString("en")}</dd>
        </div>
        <div className="ls-tile">
          <dt>Artists</dt>
          <dd>
            {(stats?.summary.artists ?? 0).toLocaleString("en")}
            {stats && stats.summary.newArtists > 0 && <span className="ls-tile-note">{stats.summary.newArtists} new to you</span>}
          </dd>
        </div>
        <div className="ls-tile">
          <dt>Streak</dt>
          <dd>
            {pluralize(local?.currentStreakDays ?? 0, "day")}
            {local && local.longestStreakDays > local.currentStreakDays && (
              <span className="ls-tile-note">Best here: {pluralize(local.longestStreakDays, "day")}</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Trend({ stats, local }: { stats: ListeningStats; local: LocalDays }) {
  const bars = trendBars(local.days);
  const max = Math.max(1, ...bars.map((bar) => bar.minutes));
  const axis = trendAxis(bars);
  const weekly = local.days.length > 90;
  const average = local.activeDays > 0 ? Math.round(stats.summary.minutes / local.activeDays) : 0;
  return (
    <section className="ls-card ls-trend" aria-labelledby="ls-trend-title">
      <header className="ls-card-head">
        <div>
          <h2 id="ls-trend-title">Your rhythm</h2>
          <p>Minutes listened {weekly ? "each week" : "each day"}</p>
        </div>
        <dl className="ls-trend-facts">
          <div>
            <dt>Active days</dt>
            <dd>{local.activeDays}</dd>
          </div>
          <div>
            <dt>On a listening day</dt>
            <dd>{formatListeningTime(average).text}</dd>
          </div>
          {local.peakDay && (
            <div>
              <dt>Biggest day</dt>
              <dd>{formatDay(local.peakDay.date, { day: "numeric", month: "short" })}</dd>
            </div>
          )}
        </dl>
      </header>
      <div className="ls-bars" role="list" aria-label={`Minutes listened ${weekly ? "each week" : "each day"}`}>
        {bars.map((bar) => {
          const height = bar.minutes > 0 ? Math.max(4, (bar.minutes / max) * 100) : 0;
          const isPeak = !weekly && local.peakDay?.date === bar.key;
          const label = `${bar.label}: ${formatListeningTime(bar.minutes).text}, ${pluralize(bar.plays, "play")}`;
          return (
            <div key={bar.key} className="ls-bar-slot" role="listitem" tabIndex={0} aria-label={label} data-tip={label}>
              <span
                className={`ls-bar${isPeak ? " is-peak" : ""}${bar.isToday ? " is-today" : ""}${bar.minutes === 0 ? " is-empty" : ""}`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="ls-axis" aria-hidden="true">
        {axis.map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
      </div>
    </section>
  );
}

function TopArtists({ artists, totalPlays }: { artists: ListeningStatsArtist[]; totalPlays: number }) {
  if (artists.length === 0) return null;
  const [first, ...rest] = artists;
  const max = first.plays;
  const href = (artist: ListeningStatsArtist) => (artist.artistId ? `/artist/${artist.artistId}` : null);
  const firstHref = href(first);
  const firstBody = (
    <>
      <Cover src={first.artworkUrl} name={first.name} className="ls-cover-xl" />
      <span className="ls-top-artist-text">
        <span className="ls-rank-badge">#1 artist</span>
        <span className="ls-top-artist-name">{first.name}</span>
        <span className="ls-top-artist-meta">
          {pluralize(first.plays, "play")} · {formatListeningTime(first.minutes).text} ·{" "}
          {totalPlays > 0 ? Math.round((first.plays / totalPlays) * 100) : 0}% of your plays
        </span>
      </span>
    </>
  );
  return (
    <section className="ls-card ls-artists" aria-labelledby="ls-artists-title">
      <header className="ls-card-head">
        <div>
          <h2 id="ls-artists-title">Top artists</h2>
          <p>Who you came back to most</p>
        </div>
      </header>
      {firstHref ? (
        <Link href={firstHref} className="ls-top-artist">
          {firstBody}
        </Link>
      ) : (
        <div className="ls-top-artist">{firstBody}</div>
      )}
      {rest.length > 0 && (
        <ol className="ls-rank-list" start={2}>
          {rest.map((artist, index) => {
            const link = href(artist);
            const name = link ? (
              <Link href={link} className="ls-rank-name">
                {artist.name}
              </Link>
            ) : (
              <span className="ls-rank-name">{artist.name}</span>
            );
            return (
              <li key={`${artist.name}-${index}`} className="ls-rank-row">
                <span className="ls-rank-number" aria-hidden="true">
                  {index + 2}
                </span>
                <Cover src={artist.artworkUrl} name={artist.name} className="ls-cover-sm is-round" />
                <span className="ls-rank-main">
                  {name}
                  <span className="ls-meter" aria-hidden="true">
                    <span style={{ width: `${(artist.plays / max) * 100}%` }} />
                  </span>
                </span>
                <span className="ls-rank-value">{pluralize(artist.plays, "play")}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function TopTracks({ tracks }: { tracks: ListeningStatsTrack[] }) {
  const { playQueue } = usePlayer();
  const { addToast } = useToast();
  if (tracks.length === 0) return null;
  const playable = tracks.filter((track) => track.available);
  const toPlayable = (track: ListeningStatsTrack) =>
    catalogItemToPlayableTrack({
      trackId: track.trackId,
      title: track.title,
      artistId: track.artistId ?? "",
      artistName: track.artistName,
      releaseId: track.releaseId,
      releaseTitle: track.releaseTitle,
      artworkUrl: track.artworkUrl,
    });
  const play = async (from: ListeningStatsTrack | null) => {
    try {
      const queue = playable.map(toPlayable);
      const start = from ? playable.findIndex((track) => track.trackId === from.trackId) : 0;
      await playQueue(queue, Math.max(0, start));
    } catch {
      addToast({ type: "error", title: "Couldn't play", message: "Please try again." });
    }
  };
  return (
    <section className="ls-card ls-tracks" aria-labelledby="ls-tracks-title">
      <header className="ls-card-head">
        <div>
          <h2 id="ls-tracks-title">Top tracks</h2>
          <p>Your most played</p>
        </div>
        {playable.length > 0 && (
          <button type="button" className="ls-play-all" onClick={() => void play(null)}>
            {PLAY_ICON}
            Play these
          </button>
        )}
      </header>
      <ol className="ls-track-list">
        {tracks.map((track, index) => (
          <li key={track.trackId} className={`ls-track-row${track.available ? "" : " is-unavailable"}`}>
            <span className="ls-rank-number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="ls-track-cover">
              <Cover src={track.artworkUrl} name={track.title} className="ls-cover-md" />
              {track.available && (
                <button
                  type="button"
                  className="ls-track-play"
                  aria-label={`Play ${track.title} by ${track.artistName}`}
                  onClick={() => void play(track)}
                >
                  {PLAY_ICON}
                </button>
              )}
            </span>
            <span className="ls-track-text">
              {track.available ? (
                <Link href={`/release/${track.releaseId}`} className="ls-track-title">
                  {track.title}
                </Link>
              ) : (
                <span className="ls-track-title">{track.title}</span>
              )}
              <span className="ls-track-artist">
                {track.artistName}
                {!track.available && " · no longer streaming"}
              </span>
            </span>
            <span className="ls-rank-value">{pluralize(track.plays, "play")}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TagBars({ title, subtitle, tags, id, tone }: { title: string; subtitle: string; tags: ListeningStatsTag[]; id: string; tone: "violet" | "coral" }) {
  return (
    <div className="ls-tags">
      <h3 id={id}>{title}</h3>
      <p>{subtitle}</p>
      {tags.length === 0 ? (
        <p className="ls-empty-note">Nothing tagged yet.</p>
      ) : (
        <ul className={`ls-tag-list is-${tone}`} aria-labelledby={id}>
          {tags.map((tag) => (
            <li key={tag.name} className="ls-tag-row">
              <span className="ls-tag-name">{tag.name}</span>
              <span className="ls-tag-share">{Math.round(tag.share * 100)}%</span>
              <span className="ls-meter is-thick" aria-hidden="true">
                <span style={{ width: `${Math.max(3, tag.share * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SoundProfile({ stats }: { stats: ListeningStats }) {
  return (
    <section className="ls-card ls-profile" aria-labelledby="ls-profile-title">
      <header className="ls-card-head">
        <div>
          <h2 id="ls-profile-title">Your sound profile</h2>
          <p>Share of your plays, by the genre and mood artists gave their releases</p>
        </div>
      </header>
      <div className="ls-profile-grid">
        <TagBars title="Genres" subtitle="What you played" tags={stats.genres} id="ls-genres-title" tone="violet" />
        <TagBars title="Moods" subtitle="How it felt" tags={stats.moods} id="ls-moods-title" tone="coral" />
      </div>
    </section>
  );
}

function PlayedThroughRing({ rate }: { rate: number | null }) {
  const percent = rate === null ? 0 : Math.round(rate * 100);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="ls-ring">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} className="ls-ring-track" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          className="ls-ring-value"
          strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
        />
      </svg>
      <span className="ls-ring-label">
        <strong>{rate === null ? "–" : `${percent}%`}</strong>
        <span>played to the end</span>
      </span>
    </div>
  );
}

function WhenYouListen({ stats }: { stats: ListeningStats }) {
  const total = MOMENT_ORDER.reduce((sum, moment) => sum + stats.moments[moment], 0);
  const best = topMoment(stats.moments);
  const max = Math.max(1, ...MOMENT_ORDER.map((moment) => stats.moments[moment]));
  const split = stats.weekdayPlays + stats.weekendPlays;
  const weekendShare = split > 0 ? Math.round((stats.weekendPlays / split) * 100) : 0;
  return (
    <section className="ls-card ls-when" aria-labelledby="ls-when-title">
      <header className="ls-card-head">
        <div>
          <h2 id="ls-when-title">When you listen</h2>
          <p>{best ? `Mostly in the ${MOMENT_LABELS[best].label.toLowerCase()}` : "By the time of day on your device"}</p>
        </div>
      </header>
      <div className="ls-when-grid">
        <ul className="ls-moments">
          {MOMENT_ORDER.map((moment) => {
            const count = stats.moments[moment];
            const share = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <li key={moment} className={`ls-moment${moment === best ? " is-best" : ""}`}>
                <span className="ls-moment-column" aria-hidden="true">
                  <span style={{ height: `${count > 0 ? Math.max(6, (count / max) * 100) : 0}%` }} />
                </span>
                <span className="ls-moment-share">{share}%</span>
                <span className="ls-moment-name">{MOMENT_LABELS[moment].label}</span>
                <span className="ls-moment-hours">{MOMENT_LABELS[moment].hours}</span>
              </li>
            );
          })}
        </ul>
        <div className="ls-when-side">
          <PlayedThroughRing rate={stats.summary.playedThroughRate} />
          {split > 0 && (
            <div className="ls-split">
              <div className="ls-split-labels">
                <span>Weekdays {100 - weekendShare}%</span>
                <span>Weekends {weekendShare}%</span>
              </div>
              <span className="ls-split-bar" aria-hidden="true">
                <span style={{ width: `${100 - weekendShare}%` }} />
              </span>
            </div>
          )}
          <p className="ls-saves">
            {HEART_ICON}
            {pluralize(stats.summary.saves, "track")} saved to your library
          </p>
        </div>
      </div>
    </section>
  );
}

function RecordingNote({ stats }: { stats: ListeningStats | null }) {
  return (
    <footer className="ls-note">
      {LOCK_ICON}
      <p>
        Only you can see this page. It is built from the plays you let Resonate remember, so files from your own device are
        not counted.{" "}
        {stats && !stats.recording ? (
          <>
            New plays are not being remembered right now. You can change that in{" "}
            <Link href="/settings?section=privacy">Privacy settings</Link>.
          </>
        ) : (
          <>
            You can stop it in <Link href="/settings?section=privacy">Privacy settings</Link> or start fresh in{" "}
            <Link href="/settings?section=taste">Taste Memory</Link>.
          </>
        )}
        {stats?.truncated && " This range is very busy, so only your most recent plays are counted."}
      </p>
    </footer>
  );
}

function EmptyState({ stats, days }: { stats: ListeningStats; days: ListeningStatsWindow }) {
  return (
    <section className="ls-card ls-empty" aria-labelledby="ls-empty-title">
      <div className="ls-empty-visual" aria-hidden="true">
        {[38, 64, 46, 82, 56, 30, 70].map((height, index) => (
          <span key={index} style={{ height: `${height}%` }} />
        ))}
      </div>
      <h2 id="ls-empty-title">No plays {windowPhrase(days)} yet</h2>
      <p>
        {stats.recording
          ? "Play something from the catalog and it shows up here: your top artists, tracks, genres and the times you listen."
          : "Resonate is not remembering your plays, so there is nothing to show. Allow it in Privacy settings to start your stats."}
      </p>
      <div className="ls-empty-actions">
        <Link href="/" className="ls-primary-link">
          Find something to play
        </Link>
        {!stats.recording && (
          <Link href="/settings?section=privacy" className="ls-secondary-link">
            Open Privacy settings
          </Link>
        )}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="ls-skeleton" aria-hidden="true">
      <div className="ls-skeleton-block is-wide" />
      <div className="ls-skeleton-block" />
      <div className="ls-skeleton-block" />
    </div>
  );
}

export default function ListeningStatsPage() {
  // The stored window is read once the page runs in the browser; until then
  // (and on the server) nothing loads, so the first fetch is the right one.
  const storedDays = useSyncExternalStore(noSubscribe, readStoredWindow, () => null);
  const [chosenDays, setDays] = useState<ListeningStatsWindow | null>(null);
  const days = chosenDays ?? storedDays;
  const { stats, isLoading, error, retry } = useListeningStats(days);
  const chooseDays = (next: ListeningStatsWindow) => {
    setDays(next);
    try {
      window.localStorage.setItem(WINDOW_STORAGE_KEY, String(next));
    } catch {
      // A private window may refuse storage; the choice still applies now.
    }
  };
  const current = stats && stats.windowDays === days ? stats : null;
  const local = useMemo(() => (current ? localDays(current) : null), [current]);
  const shown = days ?? 30;

  return (
    <AuthGate title="Sign in to see your listening.">
      <main className="ls-page" aria-busy={isLoading}>
        <Hero stats={current} local={local} days={shown} onDays={chooseDays} />
        {error && (
          <div className="ls-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void retry()}>
              Try again
            </button>
          </div>
        )}
        {!current && isLoading && <Skeleton />}
        {current && current.summary.plays === 0 && <EmptyState stats={current} days={shown} />}
        {current && current.summary.plays > 0 && (
          <div className="ls-grid">
            {local && <Trend stats={current} local={local} />}
            <TopArtists artists={current.topArtists} totalPlays={current.summary.plays} />
            <TopTracks tracks={current.topTracks} />
            <SoundProfile stats={current} />
            <WhenYouListen stats={current} />
          </div>
        )}
        <RecordingNote stats={current} />
      </main>
    </AuthGate>
  );
}
