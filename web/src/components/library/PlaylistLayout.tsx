"use client";

import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import { formatDuration } from "../../lib/metadataExtractor";

/**
 * The one look of a playlist page.
 *
 * The owner's page in the library (`PlaylistDetail`) and the shared link
 * (`PublicPlaylistView`) used to draw their header and rows separately and
 * drifted apart: big "Remove" buttons and no track numbers on one, a card
 * header and a squeezed track column on the other. Both now render these
 * pieces; the owner's page only adds owner actions (reorder, multi-select,
 * "Remove from playlist" in the row menu).
 */

export function PlaylistHero({
    artUrl,
    name,
    label,
    meta,
    actions,
    notes,
    onRename,
}: {
    artUrl: string | null | undefined;
    name: string;
    /** Badges above the title ("Public playlist", "Playlist" + "Public"). */
    label: ReactNode;
    /** The line under the title: curator, track count, length. */
    meta: ReactNode;
    actions: ReactNode;
    notes?: ReactNode;
    /** Owner only: the title becomes a button that renames the playlist. */
    onRename?: () => void;
}) {
    return (
        <div className="pl-hero glass-panel">
            <div className="pl-hero-art">
                {artUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={artUrl} alt={name} />
                ) : (
                    <div className="pl-hero-art-fallback">🎶</div>
                )}
            </div>
            <div className="pl-hero-body">
                <div className="pl-hero-label">{label}</div>
                <h1 className="pl-hero-title">
                    {onRename ? (
                        <button type="button" className="pl-hero-rename" onClick={onRename} title="Rename playlist">
                            {name}
                        </button>
                    ) : (
                        name
                    )}
                </h1>
                <div className="pl-hero-meta">{meta}</div>
                <div className="pl-hero-actions">{actions}</div>
                {notes}
            </div>
        </div>
    );
}

/** "•" between hero meta parts. */
export function PlaylistMetaDot() {
    return <span className="pl-hero-dot" aria-hidden="true">•</span>;
}

function GripIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
        </svg>
    );
}

/**
 * The "⋯" button at the end of a row. It opens the same menu as a
 * right-click on the row. Hidden until the row is hovered, focused or
 * selected (always shown on touch screens) so a long list stays quiet.
 */
export function RowMenuButton({
    label,
    expanded,
    onOpen,
    onClose,
    tabbable = true,
}: {
    label: string;
    expanded: boolean;
    onOpen: (button: HTMLButtonElement) => void;
    onClose: () => void;
    /**
     * False inside a listbox whose rows are reached with the arrow keys: the
     * list stays one tab stop and the Menu key / Shift+F10 opens this menu.
     */
    tabbable?: boolean;
}) {
    return (
        <button
            type="button"
            className={`pl-track-menu-btn${expanded ? " is-open" : ""}`}
            aria-label={label}
            title="More options"
            aria-haspopup="menu"
            aria-expanded={expanded}
            tabIndex={tabbable ? undefined : -1}
            // The menu closes itself on any outside mousedown; swallowing this
            // one lets a second press on the button close it, not reopen it.
            onMouseDown={(event) => {
                if (expanded) event.stopPropagation();
            }}
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
                if (expanded) onClose();
                else onOpen(event.currentTarget);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            draggable={false}
        >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">
                <circle cx="5" cy="12" r="1.75" />
                <circle cx="12" cy="12" r="1.75" />
                <circle cx="19" cy="12" r="1.75" />
            </svg>
        </button>
    );
}

/** Where a menu opened from a row's "⋯" button should appear. */
export function menuPositionFor(button: HTMLElement): { x: number; y: number } {
    const rect = button.getBoundingClientRect();
    // ContextMenu flips left/up when it would leave the viewport.
    return { x: rect.right, y: rect.bottom + 4 };
}

export type PlaylistTrackRowProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
    index: number;
    title: string;
    /** Artist, album and notes under the title. */
    meta: ReactNode;
    duration: number | null | undefined;
    artUrl?: string | null;
    /** Overlay on the artwork (the STEM tag). */
    artBadge?: ReactNode;
    /** Below the meta line (stem separation progress). */
    extra?: ReactNode;
    isCurrent?: boolean;
    playable?: boolean;
    /** Owner rows: the number turns into a drag grip on hover. */
    reorderable?: boolean;
    /** The row's "⋯" button, or nothing for a row without actions. */
    menu?: ReactNode;
    /** Extra state classes (selected, focused, dragging…). */
    stateClassName?: string;
    /** The row's hover text (the `title` attribute). */
    tooltip?: string;
};

export function PlaylistTrackRow({
    index,
    title,
    meta,
    duration,
    artUrl,
    artBadge,
    extra,
    isCurrent = false,
    playable = true,
    reorderable = false,
    menu,
    stateClassName = "",
    tooltip,
    className = "",
    ...rowProps
}: PlaylistTrackRowProps) {
    const classes = [
        "library-item",
        "playlist-track-item",
        "pl-track",
        playable ? "" : "is-unplayable",
        isCurrent ? "playing" : "",
        reorderable ? "is-reorderable" : "",
        stateClassName,
        className,
    ].filter(Boolean).join(" ");

    return (
        <div className={classes} title={tooltip} {...rowProps}>
            <div className="pl-track-lead">
                <span className="pl-track-number">{index + 1}</span>
                {reorderable && <span className="pl-track-grip" aria-hidden="true"><GripIcon /></span>}
            </div>
            <div className="library-item-artwork">
                {artUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={artUrl} alt="" />
                ) : (
                    <div className="library-item-artwork-placeholder">🎵</div>
                )}
                {artBadge}
            </div>
            <div className="library-item-info">
                <div className="library-item-title">{title}</div>
                <div className="library-item-meta">{meta}</div>
                {extra}
            </div>
            <div className="library-item-duration">{duration === undefined ? "—" : formatDuration(duration)}</div>
            <div className="pl-track-menu">{menu}</div>
        </div>
    );
}
