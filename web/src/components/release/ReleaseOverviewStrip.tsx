"use client";

type ReleaseOverviewItem = {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
};

type ReleaseOverviewStripProps = {
  items: ReleaseOverviewItem[];
};

export function ReleaseOverviewStrip({ items }: ReleaseOverviewStripProps) {
  return (
    <div className="release-overview-strip" aria-label="Release summary">
      {items.map((item) => (
        <div key={item.label} className={`release-overview-strip__item release-overview-strip__item--${item.tone ?? "neutral"}`}>
          <span className="release-overview-strip__label">{item.label}</span>
          <span className="release-overview-strip__value">{item.value}</span>
        </div>
      ))}

      <style jsx>{`
        .release-overview-strip {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin: 0 0 26px;
          padding: 10px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          background: linear-gradient(135deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
        }

        .release-overview-strip__item {
          min-width: 0;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.06);
          background: rgba(0,0,0,0.16);
        }

        .release-overview-strip__label {
          display: block;
          margin-bottom: 5px;
          color: rgba(255,255,255,0.42);
          font-size: 0.64rem;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .release-overview-strip__value {
          display: block;
          overflow: hidden;
          color: rgba(255,255,255,0.88);
          font-size: 0.86rem;
          font-weight: 800;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .release-overview-strip__item--success .release-overview-strip__value {
          color: #6ee7b7;
        }

        .release-overview-strip__item--warning .release-overview-strip__value {
          color: #fcd34d;
        }

        .release-overview-strip__item--danger .release-overview-strip__value {
          color: #fca5a5;
        }

        .release-overview-strip__item--accent .release-overview-strip__value {
          color: var(--color-accent);
        }

        @media (max-width: 900px) {
          .release-overview-strip {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 520px) {
          .release-overview-strip {
            grid-template-columns: 1fr;
            margin-bottom: 18px;
          }
        }
      `}</style>
    </div>
  );
}
