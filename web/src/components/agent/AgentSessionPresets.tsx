"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { AgentNextPreferences } from "../../lib/api";

export type SessionPreset = {
  intent: string;
  name: string;
  /** "genre" presets speak everyday genre language; "mood" presets describe a feel (#2052). */
  group: "genre" | "mood";
  /** What the session is for, in plain words. */
  description: string;
  input: string;
  /** What the listener will hear, shown before they start (#2052). */
  output: string;
  gradient: string;
  preferences: AgentNextPreferences;
  searchVibes: string[];
  queueStyle: string;
};

/**
 * Quick starts for the AI DJ. Genre presets come first so an everyday listener
 * finds rap, R&B or pop without decoding a mood name (#2052). Every genre is
 * in the session parser's vocabulary (`taste_edit_vocabulary.ts`), so the
 * chips a preset shows are the same filters the listener could type.
 */
export const SESSION_PRESETS: SessionPreset[] = [
  {
    intent: "Hip-Hop",
    name: "Hip-Hop & Rap",
    group: "genre",
    description: "Beats and bars, from classic hip-hop to today's trap.",
    input: "Hip-hop, rap, trap",
    output: "Hard-hitting beats with the rapper front and center",
    gradient: "linear-gradient(135deg, #f97316 0%, #b91c1c 100%)",
    preferences: { energy: "high", genres: ["Hip-Hop", "Rap", "Trap"] },
    searchVibes: ["Hip-Hop", "Rap", "Trap"],
    queueStyle: "Steady bounce",
  },
  {
    intent: "R&B",
    name: "R&B & Soul",
    group: "genre",
    description: "Smooth vocals and slow grooves for any time of day.",
    input: "R&B, soul, funk",
    output: "Silky singing over warm, laid-back grooves",
    gradient: "linear-gradient(135deg, #db2777 0%, #7c3aed 100%)",
    preferences: { energy: "medium", genres: ["R&B", "Soul", "Funk"] },
    searchVibes: ["R&B", "Soul", "Funk"],
    queueStyle: "Smooth blends",
  },
  {
    intent: "Pop",
    name: "Pop Hits",
    group: "genre",
    description: "Catchy songs with big choruses you can sing along to.",
    input: "Pop, dance, synthpop",
    output: "Upbeat, radio-friendly songs with memorable hooks",
    gradient: "linear-gradient(135deg, #ec4899 0%, #f59e0b 100%)",
    preferences: { energy: "medium", genres: ["Pop", "Dance", "Synthpop"] },
    searchVibes: ["Pop", "Dance", "Synthpop"],
    queueStyle: "Hit after hit",
  },
  {
    intent: "Afrobeats",
    name: "Afrobeats & Amapiano",
    group: "genre",
    description: "Dance-floor rhythms from Lagos to Johannesburg.",
    input: "Afrobeat, Afro-pop, amapiano",
    output: "Rolling percussion, deep log-drum bass and feel-good vocals",
    gradient: "linear-gradient(135deg, #16a34a 0%, #ca8a04 100%)",
    preferences: { energy: "high", genres: ["Afrobeat", "Afro-Pop", "Amapiano"] },
    searchVibes: ["Afrobeat", "Afro-Pop", "Amapiano"],
    queueStyle: "Keep it moving",
  },
  {
    intent: "Reggae",
    name: "Reggae & Dancehall",
    group: "genre",
    description: "Laid-back island grooves and dancehall bounce.",
    input: "Reggae, dancehall, dub",
    output: "Offbeat guitars, deep bass and sunny vocals",
    gradient: "linear-gradient(135deg, #15803d 0%, #eab308 100%)",
    preferences: { energy: "medium", genres: ["Reggae", "Dancehall", "Dub"] },
    searchVibes: ["Reggae", "Dancehall", "Dub"],
    queueStyle: "Easy rocking",
  },
  {
    intent: "Latin",
    name: "Latin & Reggaeton",
    group: "genre",
    description: "Party rhythms and Latin pop to get everyone moving.",
    input: "Latin, reggaeton",
    output: "Dembow beats, Latin percussion and Spanish-language hooks",
    gradient: "linear-gradient(135deg, #e11d48 0%, #f97316 100%)",
    preferences: { energy: "high", genres: ["Latin", "Reggaeton"] },
    searchVibes: ["Latin", "Reggaeton"],
    queueStyle: "Party pace",
  },
  {
    intent: "World",
    name: "World Music",
    group: "genre",
    description: "Traditional and modern sounds from around the globe.",
    input: "World, musiques du monde",
    output: "Voices and instruments from many cultures, old and new",
    gradient: "linear-gradient(135deg, #0d9488 0%, #a16207 100%)",
    preferences: { energy: "medium", genres: ["World", "Musiques du monde"] },
    searchVibes: ["World", "Musiques du monde"],
    queueStyle: "Wide journey",
  },
  {
    intent: "Focus",
    name: "Neural Flow",
    group: "mood",
    description: "Steady, low-friction selections for deep work or coding.",
    input: "Ambient, lo-fi, restrained drums",
    output: "Calm instrumentals with few vocals to distract you",
    gradient: "linear-gradient(135deg, #5667ff 0%, #7447ff 100%)",
    preferences: { mood: "Focus", energy: "medium", genres: ["Ambient", "Lo-fi", "Electronic"] },
    searchVibes: ["Ambient", "Lo-fi", "Electronic"],
    queueStyle: "Stable pacing",
  },
  {
    intent: "Hype",
    name: "Pulse Raid",
    group: "mood",
    description: "High-energy discoveries when the room needs momentum.",
    input: "Bass, club, trap, percussive edits",
    output: "Loud, fast club tracks with big drops",
    gradient: "linear-gradient(135deg, #ff3ea5 0%, #f04438 100%)",
    preferences: { mood: "Hype", energy: "high", genres: ["Bass", "Club", "Trap"] },
    searchVibes: ["Bass", "Club", "Trap"],
    queueStyle: "Fast cuts",
  },
  {
    intent: "Chill",
    name: "Liquid Sky",
    group: "mood",
    description: "Soft transitions for browsing, winding down, or late work.",
    input: "Soul, jazz, downtempo, warm pads",
    output: "Mellow soul and jazz with lighter drums",
    gradient: "linear-gradient(135deg, #38bdf8 0%, #7c5cff 100%)",
    preferences: { mood: "Chill", energy: "low", genres: ["Soul", "Jazz", "Downtempo"] },
    searchVibes: ["Soul", "Jazz", "Downtempo"],
    queueStyle: "Soft transitions",
  },
  {
    intent: "Dark",
    name: "Abyss Shift",
    group: "mood",
    description: "Moody, underground choices with more tension and texture.",
    input: "Industrial, drill, minor-key electronics",
    output: "Dark, heavy electronic tracks with deep bass",
    gradient: "linear-gradient(135deg, #2d033b 0%, #160014 100%)",
    preferences: { mood: "Dark", energy: "high", genres: ["Industrial", "Drill", "Electronic"] },
    searchVibes: ["Industrial", "Drill", "Electronic"],
    queueStyle: "Tension build",
  },
  {
    intent: "Zen",
    name: "Static Calm",
    group: "mood",
    description: "Minimal, spacious sessions for reset moments.",
    input: "Drone, piano, field recordings, sparse beats",
    output: "Slow, quiet piano and ambient sounds with lots of space",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #7c3aed 100%)",
    preferences: { mood: "Zen", energy: "low", genres: ["Drone", "Piano", "Ambient"] },
    searchVibes: ["Drone", "Piano", "Ambient"],
    queueStyle: "Long blends",
  },
];

type Props = {
  compact?: boolean;
  selectedIntent?: string | null;
  isStarting?: boolean;
  showOpenLink?: boolean;
  onSelect?: (preset: SessionPreset) => void;
  onStart?: (preset: SessionPreset) => void;
};

export default function AgentSessionPresets({
  compact = false,
  selectedIntent,
  isStarting = false,
  showOpenLink = true,
  onSelect,
  onStart,
}: Props) {
  return (
    <section className={`agent-session-presets ${compact ? "compact" : ""}`}>
      <div className="agent-session-copy">
        <span className="agent-session-kicker">AI DJ Session Intent</span>
        <div className="agent-session-heading-row">
          <div>
            <h2>Tell the DJ what this session is for.</h2>
            <p>
              Pick an intent to steer the mood, energy, and queue style of this session. Your saved vibes in Settings stay
              as they are. Analytics can compare the chosen intent with skips, saves, and replays.
            </p>
          </div>
          {showOpenLink ? (
            <Link href="/#ai-dj" className="agent-session-link">
              Go to your AI DJ
            </Link>
          ) : null}
        </div>
      </div>

      <div className="agent-session-grid">
        {SESSION_PRESETS.map((preset) => (
          <article
            key={preset.name}
            className={`agent-session-card ${selectedIntent === preset.intent ? "selected" : ""}`}
            style={{ "--preset-gradient": preset.gradient } as CSSProperties}
          >
            <button
              type="button"
              className="agent-session-select"
              onClick={() => onSelect?.(preset)}
              aria-pressed={selectedIntent === preset.intent}
              disabled={!onSelect}
            >
              <span className="agent-session-swatch" aria-hidden="true" />
              <div className="agent-session-card-copy">
                <span className="agent-session-intent">{preset.intent}</span>
                <h3>{preset.name}</h3>
                <p>{preset.description}</p>
              </div>
              <dl className="agent-session-details">
                <div>
                  <dt>Queue style</dt>
                  <dd>{preset.queueStyle}</dd>
                </div>
              </dl>
              <p className="agent-session-hints">{preset.input}</p>
            </button>
            {onStart && selectedIntent === preset.intent ? (
              <button
                type="button"
                className="agent-session-start"
                disabled={isStarting}
                onClick={() => onStart(preset)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
                {isStarting && selectedIntent === preset.intent ? "Starting…" : "Start with this"}
              </button>
            ) : null}
          </article>
        ))}
      </div>

      <style jsx>{`
        .agent-session-presets {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          padding: 24px;
          margin-bottom: var(--space-6);
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018));
          box-shadow: 0 22px 70px rgba(0, 0, 0, 0.28);
        }

        .agent-session-presets.compact {
          margin: 0;
          padding: 22px;
        }

        .agent-session-copy {
          position: relative;
          z-index: 1;
          margin-bottom: 22px;
        }

        .agent-session-kicker {
          display: inline-flex;
          margin-bottom: 10px;
          color: #c4b5fd;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .agent-session-heading-row {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          align-items: flex-start;
        }

        .agent-session-heading-row h2 {
          margin: 0 0 8px;
          color: #fff;
          font-size: clamp(22px, 2vw, 30px);
          line-height: 1.08;
          letter-spacing: 0;
        }

        .agent-session-heading-row p {
          max-width: 780px;
          margin: 0;
          color: rgba(255, 255, 255, 0.66);
          font-size: 14px;
          line-height: 1.65;
        }

        .agent-session-link {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 42px;
          padding: 0 18px;
          border-radius: 999px;
          border: 1px solid rgba(196, 181, 253, 0.35);
          background: rgba(124, 92, 255, 0.12);
          color: #ede9fe;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          transition:
            transform 0.2s ease,
            border-color 0.2s ease,
            background 0.2s ease;
        }

        .agent-session-link:hover {
          transform: translateY(-1px);
          border-color: rgba(196, 181, 253, 0.65);
          background: rgba(124, 92, 255, 0.2);
        }

        .agent-session-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px;
        }

        .agent-session-card {
          position: relative;
          min-height: 214px;
          padding: 16px;
          overflow: hidden;
          text-align: left;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(8, 8, 15, 0.74);
          transition:
            transform 0.18s ease,
            border-color 0.18s ease,
            background 0.18s ease,
            box-shadow 0.18s ease;
        }

        .agent-session-card:hover,
        .agent-session-card.selected {
          transform: translateY(-1px);
          border-color: rgba(196, 181, 253, 0.48);
          background: rgba(18, 16, 29, 0.9);
          box-shadow: 0 18px 42px rgba(0, 0, 0, 0.25);
        }

        .agent-session-card.selected::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          box-shadow: inset 0 0 0 1px rgba(196, 181, 253, 0.5);
          pointer-events: none;
        }

        .agent-session-select {
          display: block;
          width: 100%;
          padding: 0;
          border: 0;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
          font: inherit;
        }

        .agent-session-select:disabled {
          cursor: default;
        }

        .agent-session-swatch {
          display: block;
          width: 100%;
          height: 8px;
          margin-bottom: 14px;
          border-radius: 999px;
          background: var(--preset-gradient);
          box-shadow: 0 8px 28px rgba(124, 92, 255, 0.22);
        }

        .agent-session-card-copy {
          position: relative;
          z-index: 1;
        }

        .agent-session-intent {
          display: inline-flex;
          margin-bottom: 8px;
          color: #c4b5fd;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .agent-session-card h3 {
          margin: 0 0 8px;
          color: #fff;
          font-size: 18px;
          letter-spacing: 0;
        }

        .agent-session-card p {
          margin: 0;
          color: rgba(255, 255, 255, 0.68);
          font-size: 13px;
          line-height: 1.5;
        }

        .agent-session-details {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin: 14px 0 0;
          padding: 12px 0 0;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .agent-session-details div {
          display: grid;
          gap: 2px;
        }

        .agent-session-details dt {
          color: rgba(255, 255, 255, 0.38);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .agent-session-details dd {
          margin: 0;
          color: rgba(255, 255, 255, 0.78);
          font-size: 11px;
          line-height: 1.45;
        }

        .agent-session-hints {
          margin-top: 12px !important;
          color: rgba(255, 255, 255, 0.46) !important;
          font-size: 11px !important;
        }

        .agent-session-start {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          width: 100%;
          min-height: 40px;
          margin-top: 16px;
          padding: 0 16px;
          border-radius: 12px;
          /* Clean electric-violet (agent) — matches the main "Start Session"
             and drops the muddy violet→coral mix this used to have. */
          background: linear-gradient(135deg, var(--r-agent), var(--r-agent-soft));
          color: #fff;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.01em;
          border: 1px solid rgba(167, 139, 250, 0.5);
          box-shadow:
            0 8px 22px -8px rgba(139, 92, 246, 0.6),
            inset 0 1px 0 rgba(255, 255, 255, 0.28);
          cursor: pointer;
          transition: transform 0.18s ease, box-shadow 0.2s ease, filter 0.2s ease;
        }

        .agent-session-start svg {
          opacity: 0.95;
          flex: 0 0 auto;
        }

        .agent-session-start:hover:not(:disabled) {
          transform: translateY(-1px);
          filter: brightness(1.07);
          box-shadow:
            0 12px 28px -8px rgba(139, 92, 246, 0.78),
            inset 0 1px 0 rgba(255, 255, 255, 0.34);
        }

        .agent-session-start:active:not(:disabled) {
          transform: translateY(0);
        }

        .agent-session-card.selected .agent-session-start {
          background: linear-gradient(135deg, var(--r-agent), var(--r-agent-soft));
          color: #fff;
          border-color: rgba(167, 139, 250, 0.5);
        }

        .agent-session-start:disabled {
          cursor: not-allowed;
          opacity: 0.7;
        }

        @media (max-width: 1279px) {
          .agent-session-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 767px) {
          .agent-session-presets {
            padding: 18px;
            border-radius: 18px;
          }

          .agent-session-heading-row {
            flex-direction: column;
            gap: 14px;
          }

          .agent-session-link {
            width: 100%;
          }

          .agent-session-grid {
            display: flex;
            overflow-x: auto;
            scroll-snap-type: x mandatory;
            padding-bottom: 6px;
            margin: 0 -18px;
            padding-left: 18px;
            padding-right: 18px;
          }

          .agent-session-card {
            flex: 0 0 82%;
            min-height: 252px;
            scroll-snap-align: start;
          }
        }
      `}</style>
    </section>
  );
}
