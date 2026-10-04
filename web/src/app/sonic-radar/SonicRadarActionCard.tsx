import type { MouseEvent } from "react";

export type SonicRadarCardBadge = {
    label: string;
    tone?: "confirmed";
};

type SonicRadarActionCardProps = {
    title: string;
    artistName: string;
    artworkUrl: string | null;
    badges: SonicRadarCardBadge[];
    saving: boolean;
    /** Card click: open the release. */
    onOpen: () => void;
    onPlay: () => void;
    onSave: () => void;
};

/** A catalog track the listener can open, play or save straight from Sonic Radar. */
export default function SonicRadarActionCard({
    title,
    artistName,
    artworkUrl,
    badges,
    saving,
    onOpen,
    onPlay,
    onSave,
}: SonicRadarActionCardProps) {
    const act = (action: () => void) => (e: MouseEvent) => {
        e.stopPropagation();
        action();
    };

    return (
        <div className="sonic-radar-card" onClick={onOpen} style={{ cursor: "pointer" }}>
            <div className="sonic-radar-card-art">
                {artworkUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={artworkUrl} alt={title} loading="lazy" />
                ) : (
                    <div className="sonic-radar-card-art-placeholder">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M9 18V5l12-2v13" />
                            <circle cx="6" cy="18" r="3" />
                            <circle cx="18" cy="16" r="3" />
                        </svg>
                    </div>
                )}
            </div>
            <div className="sonic-radar-card-info">
                <span className="sonic-radar-card-title">{title}</span>
                <span className="sonic-radar-card-artist">{artistName}</span>
                <div className="sonic-radar-stems">
                    {badges.map((badge) => (
                        <span
                            key={badge.label}
                            className={`sonic-radar-stem-badge${badge.tone === "confirmed" ? " sonic-radar-stem-badge--confirmed" : ""}`}
                        >
                            {badge.label}
                        </span>
                    ))}
                </div>
            </div>
            <div className="sonic-radar-card-footer sonic-radar-card-actions">
                <button
                    type="button"
                    className="ui-btn ui-btn-ghost ui-btn-sm sonic-radar-pending-save-btn"
                    aria-label={`Play ${title}`}
                    onClick={act(onPlay)}
                >
                    Play
                </button>
                <button
                    type="button"
                    className="ui-btn ui-btn-primary ui-btn-sm sonic-radar-pending-save-btn"
                    aria-label={`Save ${title}`}
                    disabled={saving}
                    onClick={act(onSave)}
                >
                    {saving ? "Saving…" : "Save"}
                </button>
            </div>
        </div>
    );
}
