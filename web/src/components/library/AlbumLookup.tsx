"use client";

/**
 * "Look up details" in Edit album (#2538). Asks MusicBrainz, through the
 * backend, for releases matching the album, lets the listener pick one, and
 * hands its year, genre and label to the editor, which fills only empty
 * fields. Nothing is sent until the button is pressed, and only the album
 * artist, album title and track count are sent.
 */
import { useId, useState } from "react";
import {
    lookupAlbumReleaseDetailsAPI,
    lookupAlbumReleasesAPI,
    type AlbumLookupDetails,
    type AlbumLookupMatch,
} from "../../lib/api";
import { TOKEN_KEY } from "../../lib/authSession";

type Phase = "idle" | "searching" | "results" | "applying";

function storedToken(): string | null {
    try {
        return typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

function matchLine(match: AlbumLookupMatch): string {
    return [
        match.artist,
        match.year ? String(match.year) : null,
        match.country,
        match.label,
        match.trackCount ? `${match.trackCount} track${match.trackCount === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(" · ");
}

export function AlbumLookup({
    artist,
    album,
    trackCount,
    disabled,
    onPick,
}: {
    artist: string;
    album: string;
    trackCount: number;
    disabled?: boolean;
    /** Applies the picked release; returns what it filled, for the status line. */
    onPick: (details: AlbumLookupDetails) => string;
}) {
    const [phase, setPhase] = useState<Phase>("idle");
    const [matches, setMatches] = useState<AlbumLookupMatch[]>([]);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const albumTitle = album.trim();
    const hintId = `${useId().replace(/:/g, "")}-lookup-hint`;

    const search = async () => {
        setError(null);
        setStatus(null);
        const token = storedToken();
        if (!token) {
            setError("Sign in to look up album details.");
            return;
        }
        setPhase("searching");
        try {
            const result = await lookupAlbumReleasesAPI(token, { artist: artist.trim(), album: albumTitle, trackCount });
            const found = result?.matches ?? [];
            setMatches(found);
            if (found.length === 0) {
                setStatus("No match on MusicBrainz for this artist and album. Check the spelling, or fill the fields by hand.");
                setPhase("idle");
            } else {
                setPhase("results");
            }
        } catch {
            setError("Couldn't reach MusicBrainz. Check your connection and try again in a minute.");
            setPhase("idle");
        }
    };

    const pick = async (match: AlbumLookupMatch) => {
        const token = storedToken();
        if (!token) return;
        setPhase("applying");
        setError(null);
        try {
            const details = await lookupAlbumReleaseDetailsAPI(token, match.id);
            setStatus(onPick(details));
            setMatches([]);
            setPhase("idle");
        } catch {
            setError("Couldn't load that release. Try again in a minute.");
            setPhase("results");
        }
    };

    const busy = phase === "searching" || phase === "applying";

    return (
        <div className="local-file-dialog__lookup">
            <div className="local-file-dialog__lookup-bar">
                <button
                    type="button"
                    className="local-file-dialog__btn local-file-dialog__btn--small"
                    onClick={search}
                    disabled={disabled || busy || !albumTitle}
                    aria-describedby={hintId}
                >
                    {phase === "searching" ? "Looking up…" : "Look up details"}
                </button>
                <span id={hintId} className="local-file-dialog__hint">
                    {albumTitle
                        ? "Finds the year, genre and label on MusicBrainz and fills only empty fields. Sends only the artist, album and track count."
                        : "Add the album title to look it up."}
                </span>
            </div>
            {phase !== "idle" && phase !== "searching" && matches.length > 0 && (
                <div className="local-file-dialog__matches" role="group" aria-label="Matching releases on MusicBrainz">
                    <p className="local-file-dialog__matches-title">Pick the matching release</p>
                    <ul>
                        {matches.map((match) => (
                            <li key={match.id}>
                                <button
                                    type="button"
                                    className="local-file-dialog__match"
                                    onClick={() => pick(match)}
                                    disabled={busy}
                                >
                                    <span className="local-file-dialog__match-title">{match.title || "Untitled"}</span>
                                    <span className="local-file-dialog__match-meta">{matchLine(match)}</span>
                                    {match.trackCountMatches && (
                                        <span className="local-file-dialog__match-badge">Same track count</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="local-file-dialog__matches-footer">
                        <a href="https://musicbrainz.org" target="_blank" rel="noopener noreferrer">Data from MusicBrainz</a>
                        <button
                            type="button"
                            className="local-file-dialog__btn local-file-dialog__btn--small"
                            onClick={() => { setMatches([]); setPhase("idle"); }}
                            disabled={busy}
                        >
                            None of these
                        </button>
                    </div>
                </div>
            )}
            {status && <p className="local-file-dialog__note" role="status">{status}</p>}
            {error && <p className="local-file-dialog__note local-file-dialog__note--error" role="alert">{error}</p>}
        </div>
    );
}
