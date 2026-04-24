import Link from "next/link";
import type { CSSProperties } from "react";

type SessionPreset = {
  intent: string;
  name: string;
  description: string;
  tempo: string;
  input: string;
  output: string;
  gradient: string;
};

const SESSION_PRESETS: SessionPreset[] = [
  {
    intent: "Focus",
    name: "Neural Flow",
    description: "Steady, low-friction selections for deep work or coding.",
    tempo: "118-128 BPM",
    input: "Ambient, lo-fi, restrained drums",
    output: "A calm queue with minimal vocal interruptions",
    gradient: "linear-gradient(135deg, #5667ff 0%, #7447ff 100%)",
  },
  {
    intent: "Hype",
    name: "Pulse Raid",
    description: "High-energy discoveries when the room needs momentum.",
    tempo: "130-150 BPM",
    input: "Bass, club, trap, percussive edits",
    output: "Bigger drops, faster cuts, brighter stems",
    gradient: "linear-gradient(135deg, #ff3ea5 0%, #f04438 100%)",
  },
  {
    intent: "Chill",
    name: "Liquid Sky",
    description: "Soft transitions for browsing, winding down, or late work.",
    tempo: "80-105 BPM",
    input: "Soul, jazz, downtempo, warm pads",
    output: "A smooth listening lane with lighter drums",
    gradient: "linear-gradient(135deg, #38bdf8 0%, #7c5cff 100%)",
  },
  {
    intent: "Dark",
    name: "Abyss Shift",
    description: "Moody, underground choices with more tension and texture.",
    tempo: "110-135 BPM",
    input: "Industrial, drill, minor-key electronics",
    output: "Shadowy tracks and heavier low-end movement",
    gradient: "linear-gradient(135deg, #2d033b 0%, #160014 100%)",
  },
  {
    intent: "Zen",
    name: "Static Calm",
    description: "Minimal, spacious sessions for reset moments.",
    tempo: "60-90 BPM",
    input: "Drone, piano, field recordings, sparse beats",
    output: "A slower queue with room to breathe",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #7c3aed 100%)",
  },
];

type Props = {
  compact?: boolean;
};

export default function AgentSessionPresets({ compact = false }: Props) {
  return (
    <section className={`agent-session-presets ${compact ? "compact" : ""}`}>
      <div className="agent-session-copy">
        <span className="agent-session-kicker">AI DJ session presets</span>
        <div className="agent-session-heading-row">
          <div>
            <h2>Choose an intent, not a mystery orb.</h2>
            <p>
              Presets are starting points for your AI DJ. The intent tells the
              agent what the session is for, the tempo guides pacing, and the
              input hints shape what it should search, queue, and license.
            </p>
          </div>
          <Link href="/agent" className="agent-session-link">
            Open AI DJ
          </Link>
        </div>
      </div>

      <div className="agent-session-grid">
        {SESSION_PRESETS.map((preset) => (
          <article
            key={preset.name}
            className="agent-session-card"
            style={{ "--preset-gradient": preset.gradient } as CSSProperties}
          >
            <div className="agent-session-orb" aria-hidden="true" />
            <div className="agent-session-card-copy">
              <span className="agent-session-intent">{preset.intent}</span>
              <h3>{preset.name}</h3>
              <p>{preset.description}</p>
            </div>
            <dl className="agent-session-details">
              <div>
                <dt>Tempo target</dt>
                <dd>{preset.tempo}</dd>
              </div>
              <div>
                <dt>DJ listens for</dt>
                <dd>{preset.input}</dd>
              </div>
              <div>
                <dt>What you get</dt>
                <dd>{preset.output}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <style jsx>{`
        .agent-session-presets {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 28px;
          padding: 28px;
          margin-bottom: var(--space-6);
          background:
            radial-gradient(circle at 8% 0%, rgba(124, 92, 255, 0.18), transparent 32%),
            linear-gradient(135deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018));
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.34);
        }

        .agent-session-presets.compact {
          margin: 0;
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
          font-size: clamp(24px, 3vw, 38px);
          line-height: 1;
          letter-spacing: -0.04em;
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
          gap: 14px;
        }

        .agent-session-card {
          position: relative;
          min-height: 340px;
          padding: 18px;
          overflow: hidden;
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(8, 8, 15, 0.74);
        }

        .agent-session-orb {
          width: min(100%, 190px);
          aspect-ratio: 1;
          margin: 0 auto 18px;
          border-radius: 999px;
          background: var(--preset-gradient);
          box-shadow:
            inset 0 0 36px rgba(255, 255, 255, 0.12),
            0 0 0 8px rgba(124, 92, 255, 0.13),
            0 28px 60px rgba(0, 0, 0, 0.35);
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
          font-size: 17px;
          letter-spacing: -0.02em;
        }

        .agent-session-card p {
          margin: 0;
          color: rgba(255, 255, 255, 0.66);
          font-size: 12px;
          line-height: 1.5;
        }

        .agent-session-details {
          display: grid;
          gap: 10px;
          margin: 16px 0 0;
          padding: 14px 0 0;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .agent-session-details div {
          display: grid;
          gap: 2px;
        }

        .agent-session-details dt {
          color: rgba(255, 255, 255, 0.38);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .agent-session-details dd {
          margin: 0;
          color: rgba(255, 255, 255, 0.78);
          font-size: 12px;
          line-height: 1.45;
        }

        @media (max-width: 1279px) {
          .agent-session-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 767px) {
          .agent-session-presets {
            padding: 18px;
            border-radius: 22px;
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
            min-height: 320px;
            scroll-snap-align: start;
          }
        }
      `}</style>
    </section>
  );
}
