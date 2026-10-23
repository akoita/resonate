"use client";

import type { AgentMixCoverage } from "../../lib/api";
import { myMixCoverageNotes } from "../../lib/agentMyMix";
import type { UpNextItem } from "../../lib/agentUpNext";
import type { UpNextBusy } from "./useDjUpNext";

type Props = {
    /** A DJ session is open. */
    sessionLive: boolean;
    /** The DJ track playing now; null when the player is elsewhere. */
    now: UpNextItem | null;
    /** The next DJ picks in the player queue. */
    upNext: UpNextItem[];
    busy: UpNextBusy;
    /** A calm one-line message (rate limit, nothing closer, ...). */
    notice?: string | null;
    /** Explicit null hides lane labels outside My Mix. */
    mixCoverage?: AgentMixCoverage | null;
    onSkip: () => void;
    onNotThis: (item: UpNextItem) => void;
    onMoreLikeThis: (item: UpNextItem) => void;
};

function Artwork({ item }: { item: UpNextItem }) {
    if (item.artworkUrl) {
        return (
            // eslint-disable-next-line @next/next/no-img-element -- catalog release artwork served by the API
            <img className="aid-un-art" src={item.artworkUrl} alt="" loading="lazy" />
        );
    }
    return (
        <div className="aid-un-art aid-un-art--placeholder" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
        </div>
    );
}

type RowProps = {
    item: UpNextItem;
    kicker: string;
    isNow?: boolean;
    busy: UpNextBusy;
    onSkip?: () => void;
    onNotThis: (item: UpNextItem) => void;
    onMoreLikeThis: (item: UpNextItem) => void;
};

function Row({ item, kicker, isNow, busy, onSkip, onNotThis, onMoreLikeThis }: RowProps) {
    const name = `${item.title} by ${item.artist}`;
    const disabled = busy !== null;
    const isBusy = (action: string) => busy?.id === item.id && busy.action === action;
    return (
        <li className={`aid-un-row ${isNow ? "aid-un-row--now" : ""}`}>
            <Artwork item={item} />
            <div className="aid-un-info">
                <p className="aid-un-kicker">{kicker}</p>
                <p className="aid-un-title">{item.title}</p>
                <p className="aid-un-artist">{item.artist}</p>
                {item.reason ? <p className="aid-un-reason">{item.reason}</p> : null}
            </div>
            <div className="aid-un-actions" role="group" aria-label={`Steer the DJ: ${name}`}>
                {onSkip ? (
                    <button
                        type="button"
                        className="aid-un-btn"
                        onClick={onSkip}
                        disabled={disabled}
                        aria-busy={isBusy("skip")}
                        aria-label={`Skip ${name}`}
                    >
                        Skip
                    </button>
                ) : null}
                <button
                    type="button"
                    className="aid-un-btn"
                    onClick={() => onNotThis(item)}
                    disabled={disabled}
                    aria-busy={isBusy("not_this")}
                    aria-label={`Not this: ${name}`}
                >
                    Not this
                </button>
                <button
                    type="button"
                    className="aid-un-btn aid-un-btn--more"
                    onClick={() => onMoreLikeThis(item)}
                    disabled={disabled}
                    aria-busy={isBusy("more_like_this")}
                    aria-label={`More like this: ${name}`}
                >
                    More like this
                </button>
            </div>
        </li>
    );
}

/**
 * "Now & Up next" (#2243): what the DJ is playing and what it queued after it,
 * with one plain reason per pick and the three ways to steer it. Replaces the
 * Next AI Pick card. No scores or runtime strings; a rule-based pick is never
 * called an AI pick.
 */
export default function AgentUpNextCard({
    sessionLive,
    now,
    upNext,
    busy,
    notice,
    mixCoverage,
    onSkip,
    onNotThis,
    onMoreLikeThis,
}: Props) {
    const mixNotes = myMixCoverageNotes(mixCoverage);
    const hasItems = Boolean(now) || upNext.length > 0;
    // Who chose the picks, said once for the card.
    const sourceLabel = (now ?? upNext[0])?.sourceLabel ?? null;

    return (
        <section className="aid-card aid-card--up-next" aria-labelledby="aid-up-next-title">
            <div className="aid-card-header">
                <div className="aid-card-title-row">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>
                    <h3 id="aid-up-next-title" className="aid-card-title">Now &amp; Up next</h3>
                </div>
                {sessionLive ? <span className="aid-session-pill active">Session Live</span> : null}
            </div>

            {hasItems ? (
                <>
                    {sourceLabel ? <p className="aid-un-source">{sourceLabel}</p> : null}
                    <ul className="aid-un-list">
                        {now ? (
                            <Row
                                item={now}
                                kicker="Now playing"
                                isNow
                                busy={busy}
                                onSkip={upNext.length > 0 ? onSkip : undefined}
                                onNotThis={onNotThis}
                                onMoreLikeThis={onMoreLikeThis}
                            />
                        ) : null}
                        {upNext.map((item, index) => (
                            <Row
                                key={item.id}
                                item={item}
                                kicker={index === 0 ? "Up next" : "Then"}
                                busy={busy}
                                onNotThis={onNotThis}
                                onMoreLikeThis={onMoreLikeThis}
                            />
                        ))}
                    </ul>
                </>
            ) : (
                <p className="aid-un-empty">
                    {sessionLive
                        ? "The DJ is choosing what to play. Picks appear here as soon as they are queued."
                        : "Describe what you want to hear in the prompt above, then start the DJ. What plays next shows up here."}
                </p>
            )}

            {notice ? <p className="aid-un-notice" role="status">{notice}</p> : null}
            {mixNotes.length > 0 ? (
                <div className="aid-un-mix" role="status" aria-label="My Mix availability">
                    {mixNotes.map((note) => <span key={note} className="aid-un-pill">{note}</span>)}
                </div>
            ) : null}
        </section>
    );
}
