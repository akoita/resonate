"use client";

/**
 * Dialogs for the listener's own files (never catalog releases): where a file
 * lives, and editing its names and cover.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useFocusContainment } from "../ui/useFocusContainment";
import {
    getArtworkUrl,
    updateLocalTracks,
    type EditableLocalField,
    type LocalTrack,
    type LocalTrackEdit,
} from "../../lib/localLibrary";
import { getLocalFileLocation, revealInFilePicker, type LocalFileLocation } from "../../lib/localFileLocation";
import { describeFilled, fillEmptyFields } from "../../lib/albumLookup";
import { AlbumLookup } from "./AlbumLookup";
import "../../styles/local-file-dialogs.css";

function DialogShell({
    title,
    onClose,
    busy = false,
    wide = false,
    initialFocusRef,
    children,
    footer,
}: {
    title: string;
    onClose: () => void;
    busy?: boolean;
    wide?: boolean;
    initialFocusRef?: RefObject<HTMLElement | null>;
    children: ReactNode;
    footer: ReactNode;
}) {
    const [mounted, setMounted] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleId = `local-file-dialog-${useId().replace(/:/g, "")}`;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
    useEffect(() => setMounted(true), []);
    useFocusContainment({ active: mounted, containerRef: dialogRef, initialFocusRef, onEscape: onClose, escapeDisabled: busy });

    if (!mounted) return null;
    return createPortal(
        <div className="local-file-dialog__overlay" onClick={() => { if (!busy) onClose(); }}>
            <div
                ref={dialogRef}
                className={`local-file-dialog${wide ? " local-file-dialog--wide" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 id={titleId} className="local-file-dialog__title">{title}</h2>
                <div className="local-file-dialog__body">{children}</div>
                <div className="local-file-dialog__footer">{footer}</div>
            </div>
        </div>,
        document.body,
    );
}

/** "File location": the path inside the added folder, and a way to open that folder. */
export function FileLocationDialog({ track, onClose }: { track: LocalTrack; onClose: () => void }) {
    const [location, setLocation] = useState<LocalFileLocation | null>(null);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        void getLocalFileLocation(track).then((value) => { if (active) setLocation(value); });
        return () => { active = false; };
    }, [track]);

    const copyPath = async () => {
        if (!location) return;
        try {
            await navigator.clipboard.writeText(location.displayPath);
            setNote("Path copied.");
        } catch {
            setNote("Your browser blocked copying. Select the path and copy it instead.");
        }
    };

    const openFolder = async () => {
        if (!location?.handle) return;
        try {
            const opened = await revealInFilePicker(location.handle);
            if (!opened) setNote("This browser can't open the folder. Use the path above.");
        } catch {
            setNote("The browser couldn't open that folder. The file may have moved.");
        }
    };

    return (
        <DialogShell
            title="File location"
            onClose={onClose}
            footer={(
                <>
                    <button type="button" className="local-file-dialog__btn" onClick={onClose}>Close</button>
                    <button type="button" className="local-file-dialog__btn" onClick={copyPath} disabled={!location}>
                        Copy path
                    </button>
                    {location?.handle && (
                        <button type="button" className="local-file-dialog__btn local-file-dialog__btn--primary" onClick={openFolder}>
                            Open folder
                        </button>
                    )}
                </>
            )}
        >
            <p className="local-file-dialog__label">{track.title}</p>
            <code className="local-file-dialog__path">{location ? location.displayPath : "Looking for the file…"}</code>
            {location && !location.handle && (
                <p className="local-file-dialog__hint">
                    This file is on another device. The path is inside the folder you added there.
                </p>
            )}
            {location?.handle && (
                <p className="local-file-dialog__hint">
                    {location.folderName
                        ? `The path starts at "${location.folderName}", the folder you added. Browsers don't show the drive or the folders above it.`
                        : "Browsers don't show the drive or the folders above the one you added."}
                    {" "}Open folder shows it in your system file picker.
                </p>
            )}
            {note && <p className="local-file-dialog__note" role="status">{note}</p>}
        </DialogShell>
    );
}

export type EditMode = "track" | "tracks" | "album";

type FieldSpec = {
    key: EditableLocalField;
    label: string;
    modes: EditMode[];
    numeric?: { min: number; max: number };
    /** Columns out of 6 on a wide screen; full width when unset. Per mode when it differs. */
    span?: number | Partial<Record<EditMode, number>>;
    placeholder?: string;
};

const SECTIONS: Array<{ title: string; fields: FieldSpec[] }> = [
    {
        title: "Track",
        fields: [
            { key: "title", label: "Title", modes: ["track"] },
            { key: "artist", label: "Artist", modes: ["track", "tracks"], span: { tracks: 4 }, placeholder: "Main artist, feat. guests" },
            { key: "trackNumber", label: "Track no.", modes: ["track"], numeric: { min: 1, max: 999 }, span: 2 },
            { key: "discNumber", label: "Disc", modes: ["track", "tracks"], numeric: { min: 1, max: 99 }, span: 2 },
            { key: "isrc", label: "ISRC", modes: ["track"], span: 2 },
        ],
    },
    {
        title: "Album",
        fields: [
            { key: "album", label: "Album", modes: ["track", "tracks", "album"] },
            { key: "albumArtist", label: "Album artist", modes: ["track", "tracks", "album"] },
            { key: "year", label: "Year", modes: ["track", "tracks", "album"], numeric: { min: 1000, max: 2999 }, span: 2, placeholder: "e.g. 2022" },
            { key: "genre", label: "Genre", modes: ["track", "tracks", "album"], span: 4 },
        ],
    },
    {
        title: "Credits",
        fields: [
            { key: "composer", label: "Composer", modes: ["track", "tracks"], span: 3 },
            { key: "producer", label: "Producer", modes: ["track", "tracks"], span: 3 },
            { key: "label", label: "Label", modes: ["track", "tracks", "album"], span: 3 },
            { key: "copyright", label: "℗ / © line", modes: ["track", "tracks", "album"], span: 3, placeholder: "℗ 2022 Label name" },
        ],
    },
];

function spanFor(field: FieldSpec, mode: EditMode): number {
    const span = typeof field.span === "number" ? field.span : field.span?.[mode];
    return span ?? 6;
}

type FieldState = { initial: string; mixed: boolean };

function asText(value: unknown): string {
    return value === null || value === undefined ? "" : String(value);
}

/** Each field's starting value: shared by every track, or "mixed" when they differ. */
export function initialFieldStates(tracks: LocalTrack[], mode: EditMode): Record<string, FieldState> {
    const states: Record<string, FieldState> = {};
    for (const field of SECTIONS.flatMap((section) => section.fields)) {
        const values = new Set(tracks.map((track) => asText(track[field.key])));
        const [only] = values;
        states[field.key] = values.size === 1 ? { initial: only ?? "", mixed: false } : { initial: "", mixed: true };
    }
    // An album with no album artist is grouped under its tracks' artist: start from that.
    if (mode === "album" && !states.albumArtist?.mixed && !states.albumArtist?.initial) {
        const artists = new Set(tracks.map((track) => asText(track.artist)));
        if (artists.size === 1) states.albumArtist = { initial: [...artists][0] ?? "", mixed: false };
    }
    return states;
}

/**
 * The edit to apply from the form: only the fields the listener changed. A
 * "mixed" field left empty keeps each track's own value. Returns an error
 * message instead when a number is not valid.
 */
export function editFromForm(
    values: Record<string, string>,
    states: Record<string, FieldState>,
    mode: EditMode,
): { edit: LocalTrackEdit } | { error: string } {
    const edit: Record<string, unknown> = {};
    for (const field of SECTIONS.flatMap((section) => section.fields)) {
        if (!field.modes.includes(mode)) continue;
        const state = states[field.key];
        if (!state || values[field.key] === undefined) continue;
        const value = values[field.key]!.trim();
        if (state.mixed ? value === "" : value === state.initial.trim()) continue;
        if (field.numeric && value !== "") {
            const n = Number(value);
            if (!Number.isInteger(n) || n < field.numeric.min || n > field.numeric.max) {
                return { error: `${field.label} must be a whole number from ${field.numeric.min} to ${field.numeric.max}.` };
            }
            edit[field.key] = n;
        } else {
            edit[field.key] = value === "" ? null : value;
        }
    }
    return { edit: edit as LocalTrackEdit };
}

function CoverPlaceholder() {
    return (
        <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
        </svg>
    );
}

/**
 * Edit the listener's own files: one track, several selected tracks, or every
 * file of a local album. Edits are saved in Resonate for the account (so they
 * follow it to every device) and never written into the files. The cover is
 * kept on this device.
 */
export function EditLocalDetailsDialog({
    tracks,
    mode,
    onClose,
    onSaved,
}: {
    tracks: LocalTrack[];
    mode: EditMode;
    onClose: () => void;
    onSaved: (updated: LocalTrack[]) => void;
}) {
    const first = tracks[0];
    const [states] = useState(() => initialFieldStates(tracks, mode));
    const [values, setValues] = useState<Record<string, string>>(
        () => Object.fromEntries(Object.entries(states).map(([key, state]) => [key, state.initial])),
    );
    const [artwork, setArtwork] = useState<File | null>(null);
    const [previewReady, setPreviewReady] = useState(false);
    const [currentCover, setCurrentCover] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const ids = useId().replace(/:/g, "");
    const firstFieldRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let active = true;
        const withArt = tracks.find((track) => track.artworkKey);
        if (withArt) void getArtworkUrl(withArt).then((url) => { if (active) setCurrentCover(url); });
        return () => { active = false; };
    }, [tracks]);

    // Draw the chosen image on a canvas: it is decoded as an image and never
    // handed to the page as a URL.
    const previewRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        if (!artwork) return;
        let cancelled = false;
        void createImageBitmap(artwork).then(
            (bitmap) => {
                const canvas = previewRef.current;
                if (cancelled || !canvas) return bitmap.close();
                const side = Math.min(bitmap.width, bitmap.height);
                canvas.width = 240;
                canvas.height = 240;
                canvas.getContext("2d")?.drawImage(
                    bitmap,
                    (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
                    0, 0, 240, 240,
                );
                bitmap.close();
                setPreviewReady(true);
            },
            () => {
                if (cancelled) return;
                setArtwork(null);
                setError("That file isn't an image this browser can read.");
            },
        );
        return () => { cancelled = true; };
    }, [artwork]);

    if (!first) return null;

    const count = tracks.length;
    const files = `${count} file${count === 1 ? "" : "s"}`;
    const heading = mode === "album" ? "Edit album" : mode === "tracks" ? `Edit ${count} tracks` : "Edit track";
    const subtitle = mode === "album"
        ? `${values.album || first.album || "Untitled album"} · ${files}`
        : mode === "tracks"
            ? `${files} selected`
            : [first.title, first.artist].filter(Boolean).join(" · ");
    const showNewCover = Boolean(artwork && previewReady);
    const visibleSections = SECTIONS.filter((section) => section.fields.some((field) => field.modes.includes(mode)));
    const anyMixed = visibleSections.some((section) => section.fields.some(
        (field) => field.modes.includes(mode) && states[field.key]?.mixed,
    ));

    const save = async () => {
        const result = editFromForm(values, states, mode);
        if ("error" in result) {
            setError(result.error);
            return;
        }
        if (mode === "track" && !values.title?.trim()) {
            setError("A track needs a title.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const updated = await updateLocalTracks(tracks.map((track) => ({ track, edit: result.edit })), artwork);
            onSaved(updated);
            onClose();
        } catch (err) {
            console.error("[Library] Failed to edit local file details:", err);
            setError("Couldn't save. Check your connection and try again.");
            setBusy(false);
        }
    };

    return (
        <DialogShell
            title={heading}
            onClose={onClose}
            busy={busy}
            wide
            initialFocusRef={firstFieldRef}
            footer={(
                <>
                    <p className="local-file-dialog__footnote">
                        Saved in Resonate for your account, on every device. Your files on disk are not changed.
                    </p>
                    <button type="button" className="local-file-dialog__btn" onClick={onClose} disabled={busy}>Cancel</button>
                    <button
                        type="button"
                        className="local-file-dialog__btn local-file-dialog__btn--primary"
                        onClick={save}
                        disabled={busy}
                    >
                        {busy ? "Saving…" : mode === "track" ? "Save" : `Save ${files}`}
                    </button>
                </>
            )}
        >
            <div className="local-file-dialog__header">
                <div className="local-file-dialog__cover">
                    <canvas ref={previewRef} role="img" aria-label="New cover" hidden={!showNewCover} />
                    {!showNewCover && currentCover && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={currentCover} alt="Current cover" />
                    )}
                    {!showNewCover && !currentCover && <CoverPlaceholder />}
                </div>
                <div className="local-file-dialog__header-text">
                    <p className="local-file-dialog__subtitle">{subtitle}</p>
                    <input
                        id={`${ids}-art`}
                        type="file"
                        accept="image/*"
                        className="local-file-dialog__file"
                        onChange={(e) => {
                            setPreviewReady(false);
                            setError(null);
                            setArtwork(e.target.files?.[0] ?? null);
                        }}
                    />
                    <label className="local-file-dialog__btn local-file-dialog__btn--small" htmlFor={`${ids}-art`}>
                        {artwork || currentCover ? "Change cover" : "Add cover"}
                    </label>
                    <span className="local-file-dialog__hint">The cover is kept on this device.</span>
                </div>
            </div>
            {visibleSections.map((section) => {
                const fields = section.fields.filter((field) => field.modes.includes(mode));
                return (
                    <fieldset key={section.title} className="local-file-dialog__section">
                        <legend>{section.title}</legend>
                        <div className="local-file-dialog__grid">
                            {fields.map((field, index) => {
                                const mixed = states[field.key]?.mixed;
                                return (
                                    <label
                                        key={field.key}
                                        className="local-file-dialog__field"
                                        style={{ "--span": spanFor(field, mode) } as CSSProperties}
                                    >
                                        <span>{field.label}</span>
                                        <input
                                            ref={section === visibleSections[0] && index === 0 ? firstFieldRef : undefined}
                                            value={values[field.key] ?? ""}
                                            inputMode={field.numeric ? "numeric" : undefined}
                                            placeholder={mixed ? "Mixed" : field.placeholder}
                                            required={field.key === "title"}
                                            disabled={busy}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                setValues((previous) => ({ ...previous, [field.key]: value }));
                                            }}
                                        />
                                    </label>
                                );
                            })}
                        </div>
                        {mode === "album" && section.title === "Album" && (
                            <AlbumLookup
                                artist={values.albumArtist || first.artist || ""}
                                album={values.album ?? ""}
                                trackCount={count}
                                disabled={busy}
                                onPick={(details) => {
                                    const result = fillEmptyFields(values, (key) => Boolean(states[key]?.mixed), details);
                                    setValues(result.values);
                                    return result.filled.length > 0
                                        ? `${describeFilled(result.filled)} Check it, then save.`
                                        : "Nothing to fill: year, genre and label already have values, or MusicBrainz has none.";
                                }}
                            />
                        )}
                    </fieldset>
                );
            })}
            {anyMixed && (
                <p className="local-file-dialog__hint">
                    Fields marked Mixed differ between these tracks. Leave them empty to keep each track&apos;s own value.
                </p>
            )}
            {error && <p className="local-file-dialog__note local-file-dialog__note--error" role="alert">{error}</p>}
        </DialogShell>
    );
}
