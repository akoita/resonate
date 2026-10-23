import type { DjPickNote } from "../../lib/agentDjSet";

export const OUTSIDE_REQUEST_LABEL = "Outside your request";
export const OUTSIDE_REQUEST_HINT =
    "Your AI DJ added this to fill the set; it doesn't match your request's filters.";

/** The accessible name and hover text of the DJ glyph: the pick's reason when there is one. */
export function djPickLabel(note?: DjPickNote): string {
    const reason = note?.reason?.trim();
    return reason ? `Picked by your AI DJ: ${reason}` : "Picked by your AI DJ";
}

type Props = {
    /** The DJ's note on this pick; absent for a pick the client has no note on. */
    note?: DjPickNote;
};

/**
 * The marks on a queue row the AI DJ picked (#2312): a small DJ glyph carrying
 * the pick's reason (hover, focus and accessible name), and a muted "Outside
 * your request" mark only when the server said the pick missed the session's
 * filters (`matched === false`). A row with no flag shows no such mark.
 */
export function PlayerQueueDjMark({ note }: Props) {
    const label = djPickLabel(note);
    return (
        <>
            <span
                className="queue-dj-glyph"
                role="img"
                tabIndex={0}
                aria-label={label}
                title={label}
                data-testid="queue-dj-glyph"
                onClick={(event) => event.stopPropagation()}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
                    <path d="M19 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
                </svg>
            </span>
            {note?.matched === false ? (
                <span className="queue-dj-outside" title={OUTSIDE_REQUEST_HINT} data-testid="queue-dj-outside">
                    {OUTSIDE_REQUEST_LABEL}
                </span>
            ) : null}
        </>
    );
}
