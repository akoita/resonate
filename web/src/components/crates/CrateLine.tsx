import {
  describeTransition,
  formatBpm,
  formatEnergy,
  formatStemQuality,
  formatUsd,
  INDICATIVE_PRICE_TEXT,
  NO_STANDARD_TERMS_TEXT,
  type CrateItemDto,
  type CrateTransitionFacts,
} from "../../lib/crates";
import "../../styles/crates.css";

export type TransitionPreviewState = "idle" | "loading" | "playing";

export type CrateLineProps = {
  item: CrateItemDto;
  /** 0-based index in the order on screen. */
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  busy?: boolean;
  /** Title of the next line, when there is one. */
  nextTitle?: string | null;
  /** What changes into the next line, derived from the order on screen. */
  transition?: CrateTransitionFacts | null;
  /** Present only when both lines have audio to preview. */
  previewState?: TransitionPreviewState;
  onMove: (direction: -1 | 1) => void;
  onToggleLock: () => void;
  onSwap: () => void;
  onRemove: () => void;
  onPreviewTransition?: () => void;
};

const AI_LABELS: Record<string, string> = {
  NONE: "Declared AI-free",
  PARTLY: "Partly AI",
  ALL: "Fully AI-generated",
};

function aiLabel(level: string | null): string | null {
  if (!level) return null;
  return AI_LABELS[level.toUpperCase()] ?? null;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

export function CrateLine({
  item,
  index,
  canMoveUp,
  canMoveDown,
  busy = false,
  nextTitle,
  transition,
  previewState,
  onMove,
  onToggleLock,
  onSwap,
  onRemove,
  onPreviewTransition,
}: CrateLineProps) {
  const label = `"${item.title}"`;
  const ai = aiLabel(item.aiDisclosureLevel);
  const stems =
    item.stems.length > 0
      ? item.stems
      : item.stemTypes.map((type) => ({ type, qualityScore: null as number | null }));
  const className = [
    "crates-line",
    item.locked ? "crates-line--locked" : "",
    item.available ? "" : "crates-line--unavailable",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={className} data-track-id={item.trackId}>
      <div className="crates-line-head">
        <span className="crates-line-pos" aria-hidden="true">
          {index + 1}
        </span>
        <h3 className="crates-line-title">{item.title}</h3>
        {item.artistName ? <span className="crates-line-artist">by {item.artistName}</span> : null}
        {item.locked ? <span className="crates-badge">Locked</span> : null}
        {!item.available ? <span className="crates-badge crates-badge--warn">Unavailable</span> : null}
        {item.verifiedHuman ? <span className="crates-badge">Verified human</span> : null}
        {ai ? <span className="crates-badge">{ai}</span> : null}
      </div>

      {!item.available ? (
        <p className="crates-hint">
          This track is no longer available to play or license. It stays in your crate until you
          remove it or swap it.
        </p>
      ) : null}

      <ul className="crates-stats" aria-label={`Measured details for ${label}`}>
        <li>{formatBpm(item.tempoBpm)}</li>
        <li>{item.camelot ? `Key ${item.camelot}` : "Key unknown"}</li>
        <li>{formatEnergy(item.energy)}</li>
      </ul>

      {item.explanation && item.explanation.length > 0 ? (
        <p className="crates-hint">{item.explanation.join(" · ")}</p>
      ) : null}

      {stems.length > 0 ? (
        <ul className="crates-stem-chips" aria-label={`Stems for ${label}`}>
          {stems.map((stem) => {
            const quality = formatStemQuality(stem.qualityScore);
            return (
              <li key={stem.type} className="crates-stem-chip">
                {titleCase(stem.type)}
                {quality ? ` · quality ${quality}` : " · quality not scored"}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="crates-hint">No stems available for this track yet.</p>
      )}

      <details className="crates-license">
        <summary>
          License options
          {item.linePriceUsd !== null ? ` · about ${formatUsd(item.linePriceUsd)} for this crate` : ""}
        </summary>
        {item.licenseOptions.length > 0 ? (
          <ul className="crates-license-options">
            {item.licenseOptions.map((option) => (
              <li key={option.licenseType} className="crates-license-option">
                <h4>
                  <span>{titleCase(option.licenseType)}</span>
                  <span>
                    {option.listed
                      ? option.indicativePriceUsd !== null
                        ? `about ${formatUsd(option.indicativePriceUsd)}`
                        : "Listed"
                      : "Not listed"}
                  </span>
                </h4>
                {option.standardTerms && option.grants.length > 0 ? (
                  <ul aria-label={`What a ${option.licenseType} license grants`}>
                    {option.grants.map((grant) => (
                      <li key={grant}>{grant}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{NO_STANDARD_TERMS_TEXT}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="crates-hint">No license options are listed for this track yet.</p>
        )}
        <p className="crates-hint">{INDICATIVE_PRICE_TEXT}</p>
      </details>

      <div className="crates-row" role="group" aria-label={`Actions for ${label}`}>
        <button
          type="button"
          className="crates-btn"
          onClick={() => onMove(-1)}
          disabled={busy || !canMoveUp}
          aria-label={`Move ${label} up`}
        >
          Move up
        </button>
        <button
          type="button"
          className="crates-btn"
          onClick={() => onMove(1)}
          disabled={busy || !canMoveDown}
          aria-label={`Move ${label} down`}
        >
          Move down
        </button>
        <button
          type="button"
          className="crates-btn"
          onClick={onToggleLock}
          disabled={busy}
          aria-pressed={item.locked}
          aria-label={item.locked ? `Unlock ${label}` : `Lock ${label} in place`}
        >
          {item.locked ? "Locked" : "Lock"}
        </button>
        <button
          type="button"
          className="crates-btn"
          onClick={onSwap}
          disabled={busy || item.locked}
          aria-label={`Swap ${label} for a similar track`}
          title={item.locked ? "Unlock this line to swap it" : undefined}
        >
          Swap for similar
        </button>
        <button
          type="button"
          className="crates-btn crates-btn--danger"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove ${label} from the crate`}
        >
          Remove
        </button>
      </div>

      {transition && nextTitle ? (
        <div className="crates-transition">
          <span>
            Into &quot;{nextTitle}&quot;: {describeTransition(transition)}
          </span>
          {previewState ? (
            <>
              {" "}
              <button
                type="button"
                className="crates-btn"
                onClick={onPreviewTransition}
                disabled={previewState === "loading"}
                aria-label={
                  previewState === "playing"
                    ? "Stop the transition preview"
                    : `Preview the transition from ${label} into "${nextTitle}"`
                }
              >
                {previewState === "playing"
                  ? "Stop preview"
                  : previewState === "loading"
                    ? "Loading preview…"
                    : "Preview transition"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
