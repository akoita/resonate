"use client";

/**
 * Dialogs for the listener's own files (never catalog releases): where a file
 * lives, and editing its names and cover.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusContainment } from "../ui/useFocusContainment";
import { updateLocalTrack, type LocalTrack, type LocalTrackEdit } from "../../lib/localLibrary";
import { getLocalFileLocation, revealInFilePicker, type LocalFileLocation } from "../../lib/localFileLocation";
import "../../styles/local-file-dialogs.css";

function DialogShell({
    title,
    onClose,
    busy = false,
    children,
    footer,
}: {
    title: string;
    onClose: () => void;
    busy?: boolean;
    children: ReactNode;
    footer: ReactNode;
}) {
    const [mounted, setMounted] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const titleId = `local-file-dialog-${useId().replace(/:/g, "")}`;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
    useEffect(() => setMounted(true), []);
    useFocusContainment({ active: mounted, containerRef: dialogRef, onEscape: onClose, escapeDisabled: busy });

    if (!mounted) return null;
    return createPortal(
        <div className="local-file-dialog__overlay" onClick={() => { if (!busy) onClose(); }}>
            <div
                ref={dialogRef}
                className="local-file-dialog"
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

type EditMode = "track" | "album";

/**
 * Edit the listener's own files: one track, or every file of a local album.
 * The cover is kept on this device; names sync to the listener's library.
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
    const [title, setTitle] = useState(first?.title ?? "");
    const [artist, setArtist] = useState((mode === "album" ? first?.albumArtist || first?.artist : first?.artist) ?? "");
    const [album, setAlbum] = useState(first?.album ?? "");
    const [artwork, setArtwork] = useState<File | null>(null);
    const [previewReady, setPreviewReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const ids = useId().replace(/:/g, "");

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
                canvas.width = 144;
                canvas.height = 144;
                canvas.getContext("2d")?.drawImage(
                    bitmap,
                    (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
                    0, 0, 144, 144,
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

    const save = async () => {
        setBusy(true);
        setError(null);
        try {
            const updated: LocalTrack[] = [];
            for (const track of tracks) {
                const edit: LocalTrackEdit = mode === "track"
                    ? { title, artist, album }
                    : { album, artist, albumArtist: artist };
                updated.push(await updateLocalTrack(track, edit, artwork));
            }
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
            title={mode === "album" ? "Edit album" : "Edit details"}
            onClose={onClose}
            busy={busy}
            footer={(
                <>
                    <button type="button" className="local-file-dialog__btn" onClick={onClose} disabled={busy}>Cancel</button>
                    <button
                        type="button"
                        className="local-file-dialog__btn local-file-dialog__btn--primary"
                        onClick={save}
                        disabled={busy || (mode === "track" && !title.trim())}
                    >
                        {busy ? "Saving…" : "Save"}
                    </button>
                </>
            )}
        >
            <p className="local-file-dialog__hint">
                {mode === "album"
                    ? `Changes apply to the ${tracks.length} file${tracks.length === 1 ? "" : "s"} of yours in this album. Your files on disk are not changed.`
                    : "Changes apply to your library only. The file on disk is not changed."}
            </p>
            <div className="local-file-dialog__art">
                <canvas
                    ref={previewRef}
                    role="img"
                    aria-label="New cover"
                    hidden={!artwork || !previewReady}
                />
                {(!artwork || !previewReady) && <span className="ms-icon" aria-hidden="true">image</span>}
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
                <label className="local-file-dialog__btn" htmlFor={`${ids}-art`}>
                    {artwork ? "Change image" : "Choose cover image"}
                </label>
            </div>
            {mode === "track" && (
                <label className="local-file-dialog__field">
                    <span>Title</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} required />
                </label>
            )}
            <label className="local-file-dialog__field">
                <span>{mode === "album" ? "Album artist" : "Artist"}</span>
                <input value={artist} onChange={(e) => setArtist(e.target.value)} />
            </label>
            <label className="local-file-dialog__field">
                <span>Album</span>
                <input value={album} onChange={(e) => setAlbum(e.target.value)} />
            </label>
            <p className="local-file-dialog__hint">The cover is kept on this device.</p>
            {error && <p className="local-file-dialog__note local-file-dialog__note--error" role="alert">{error}</p>}
        </DialogShell>
    );
}
