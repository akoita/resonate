"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";
import {
    Playlist,
    getPlaylist,
    removeTracksFromPlaylist,
    reorderTracks,
    renamePlaylist,
} from "../../lib/playlistStore";
import { LocalTrack, getTrack, getArtworkUrl, withKnownDuration } from "../../lib/localLibrary";
import { catalogTrackIdOf } from "../../lib/trackIdentity";
import { usePlayer } from "../../lib/playerContext";
import { useQueueActions } from "../../lib/useQueueActions";
import { QueueActionsButton } from "../player/QueueActionsButton";
import { formatDuration } from "../../lib/metadataExtractor";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { useToast } from "../ui/Toast";
import { PromptModal } from "../ui/PromptModal";
import { PlaylistShareControl } from "./PlaylistShareControl";
import StartDjFromSeedButton from "../agent/StartDjFromSeedButton";
import type { PlaylistVisibility } from "../../lib/playlistStore";
import { useWebSockets } from "../../hooks/useWebSockets";
import {
    applyPlaylistDrop,
    parsePlaylistDropPayload,
    playlistDropEffect,
    playlistDropForTarget,
    playlistDropToast,
    playlistSourceType,
    type PlaylistAddRequest,
} from "../layout/playlistDrop";
import { libraryArtistHref } from "../../lib/artistRoutes";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";
import {
    TrackUnavailableNote,
    queueableTracks,
    resolveAvailability,
} from "./trackAvailability";
import { AddToPlaylistIcon, AddToQueueIcon, LoopIcon, PlayIcon, PlayNextIcon, RemoveIcon, RepeatIcon } from "../ui/MenuIcons";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { TrackSelectionBar } from "../player/TrackSelectionBar";
import { useListSelection } from "../../lib/useListSelection";
import { PlaylistHero, PlaylistMetaDot, PlaylistTrackRow, RowMenuButton, menuPositionFor } from "./PlaylistLayout";
import { useUIStore } from "../../lib/uiStore";

interface PlaylistDetailProps {
    playlistId: string;
    onBack: () => void;
}

/**
 * One position in the playlist, in the order the playlist stores it.
 *
 * `track` is null when the entry no longer resolves to anything we can play.
 * The row is rendered anyway (#1793): a playlist that silently shrinks tells
 * the listener nothing, and they can no longer even remove the dead entry.
 */
type PlaylistEntry = { id: string; track: LocalTrack | null };

export function PlaylistDetail({ playlistId, onBack }: PlaylistDetailProps) {
    const router = useRouter();
    const [playlist, setPlaylist] = useState<Playlist | null>(null);
    const [entries, setEntries] = useState<PlaylistEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [artworkUrls, setArtworkUrls] = useState<Map<string, string>>(new Map());
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    // Everything that resolved, in playlist order — what the hero counts.
    const tracks = useMemo(
        () => entries.map((entry) => entry.track).filter((t): t is LocalTrack => t !== null),
        [entries],
    );
    // What may actually go into a queue. Never used for rendering the list.
    const playableTracks = useMemo(() => queueableTracks(tracks), [tracks]);

    const { playQueue, currentTrack, setRepeatMode } = usePlayer();
    const queueActions = useQueueActions();
    const setTracksToAddToPlaylist = useUIStore((state) => state.setTracksToAddToPlaylist);
    const setTrackForRepeats = useUIStore((state) => state.setTrackForRepeats);
    /**
     * The open track menu, from a right-click, the row's "⋯" button (its
     * `opener`, which gets focus back) or the Menu key / Shift+F10.
     */
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, indices: number[], row: number, opener: HTMLElement | null, fromButton: boolean } | null>(null);
    /** Entry ids waiting on the "remove several" confirmation. */
    const [pendingRemoval, setPendingRemoval] = useState<string[] | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const { addToast } = useToast();
    const [trackProgress, setTrackProgress] = useState<Map<string, number>>(new Map());

    const loadPlaylistData = useCallback(async () => {
        setLoading(true);
        const p = await getPlaylist(playlistId);
        if (p) {
            setPlaylist(p);

            // Load actual track data. Entries that no longer resolve stay in
            // the list as unavailable rows rather than vanishing (#1793).
            const trackData: PlaylistEntry[] = await Promise.all(
                p.trackIds.map(async (id) => {
                    const track = await getTrack(id);
                    // Copies saved without a length showed "--:--" here while
                    // the shared page, read from the server, had it.
                    return { id, track: track ? await withKnownDuration(track) : null };
                }),
            );
            setEntries(trackData);

            // Load artwork
            const urls = new Map<string, string>();
            for (const track of trackData.map((e) => e.track).filter((t): t is LocalTrack => t !== null)) {
                const url = await getArtworkUrl(track);
                if (url) urls.set(track.id, url);
            }
            setArtworkUrls(urls);
        }
        setLoading(false);
    }, [playlistId]);

    useWebSockets(
        (data) => {
            if (data.status === 'ready') {
                void loadPlaylistData();
                setTrackProgress((prev) => {
                    const next = new Map(prev);
                    next.delete(data.releaseId);
                    return next;
                });
            }
        },
        (data) => {
            setTrackProgress((prev) => new Map(prev).set(data.trackId, data.progress));
        }
    );

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadPlaylistData();
    }, [loadPlaylistData]);

    const handlePlayTrack = useCallback((track: LocalTrack) => {
        const index = playableTracks.findIndex((t) => t.id === track.id);
        if (index < 0) return; // not playable — nothing to start
        void playQueue(playableTracks, index, { playlistId, sourceTrackIds: playlist?.trackIds });
        recordProductAnalyticsFromBrowser("playlist.played", {
            source: "playlist_detail_track",
            subjectType: "playlist",
            subjectId: playlistId,
            payload: {
                playlistId,
                // A device file's id never leaves the device (#2507).
                trackId: catalogTrackIdOf(track) ?? undefined,
                startIndex: index,
                trackCount: playableTracks.length,
            },
        });
    }, [playQueue, playlistId, playableTracks, playlist]);

    const confirmRemoveEntries = async () => {
        const ids = pendingRemoval ?? [];
        setPendingRemoval(null);
        if (ids.length === 0) return;
        await removeTracksFromPlaylist(playlistId, ids);
        await loadPlaylistData();
        addToast({ type: "success", title: "Removed", message: `${ids.length} track${ids.length === 1 ? "" : "s"} removed from playlist` });
    };

    const playEntryRow = useCallback((index: number) => {
        const track = entries[index]?.track;
        if (track && resolveAvailability(track).playable) handlePlayTrack(track);
    }, [entries, handlePlayTrack]);

    const requestRemoveRows = useCallback((indices: number[]) => {
        const ids = [...new Set(indices.map((index) => entries[index]?.id).filter((id): id is string => Boolean(id)))];
        if (ids.length > 0) setPendingRemoval(ids);
    }, [entries]);

    // Opened from the keyboard: anchor the menu on the row's "⋯" button.
    // `contextTargets` is read through a ref because the selection hook
    // needs this callback before it returns.
    const contextTargetsRef = useRef<(index: number) => number[]>((index) => [index]);
    const openMenuFromKeyboard = useCallback((index: number) => {
        const row = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`);
        const button = row?.querySelector<HTMLElement>(".pl-track-menu-btn");
        const anchor = button ?? row;
        if (!anchor) return;
        const position = button ? menuPositionFor(button) : (() => {
            const rect = anchor.getBoundingClientRect();
            return { x: rect.left + 24, y: rect.bottom };
        })();
        setContextMenu({ ...position, indices: contextTargetsRef.current(index), row: index, opener: listRef.current, fromButton: false });
    }, []);

    // Shift/Ctrl/Cmd+click and the keyboard select rows; a plain click still plays.
    const rowSelection = useListSelection({
        count: entries.length,
        resetKey: entries.map((entry) => entry.id).join("\u0000"),
        listRef,
        onActivate: playEntryRow,
        onRemove: requestRemoveRows,
        onMenu: openMenuFromKeyboard,
    });
    useEffect(() => {
        contextTargetsRef.current = rowSelection.contextTargets;
    });

    const handleContextMenu = (e: React.MouseEvent, index: number) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, indices: rowSelection.contextTargets(index), row: index, opener: null, fromButton: false });
    };

    const openRowMenu = (button: HTMLButtonElement, index: number) => {
        setContextMenu({ ...menuPositionFor(button), indices: rowSelection.contextTargets(index), row: index, opener: button, fromButton: true });
    };

    /** The row's "⋯" button: same menu as a right-click on it. */
    const rowMenuButton = (index: number, title: string) => (
        <RowMenuButton
            label={`More options for ${title}`}
            expanded={contextMenu?.row === index && contextMenu.fromButton}
            onOpen={(button) => openRowMenu(button, index)}
            onClose={() => setContextMenu(null)}
            tabbable={false}
        />
    );

    /** Everything that applies to several playlist rows at once. */
    const getSelectionItems = (indices: number[]): ContextMenuItem[] => {
        const selectedTracks = indices
            .map((index) => entries[index]?.track)
            .filter((track): track is LocalTrack => Boolean(track));
        const playable = queueableTracks(selectedTracks);
        const noPlayable = playable.length === 0;
        return [
            { label: "Play", icon: <PlayIcon />, disabled: noPlayable, onClick: () => void playQueue(playable, 0) },
            { label: "Loop These", icon: <LoopIcon />, disabled: noPlayable, onClick: () => {
                setRepeatMode("all");
                void playQueue(playable, 0);
                addToast({ type: "success", title: `Looping ${playable.length} track${playable.length === 1 ? "" : "s"}` });
            } },
            { label: "Play Next", icon: <PlayNextIcon />, disabled: noPlayable, onClick: () => queueActions.queue(playable, "next") },
            { label: "Add to Queue", icon: <AddToQueueIcon />, disabled: noPlayable, onClick: () => queueActions.queue(playable, "queue") },
            { label: "Set Repeats…", icon: <RepeatIcon />, disabled: noPlayable, onClick: () => setTrackForRepeats(playable) },
            { separator: true, label: "", onClick: () => { } },
            { label: "Add to Playlist", icon: <AddToPlaylistIcon />, disabled: selectedTracks.length === 0, onClick: () => setTracksToAddToPlaylist(selectedTracks) },
            { label: "Remove from Playlist", icon: <RemoveIcon />, variant: "destructive", onClick: () => requestRemoveRows(indices) },
        ];
    };

    const getTrackContextMenuItems = (indices: number[]): ContextMenuItem[] => {
        if (indices.length > 1) return getSelectionItems(indices);
        const entry = entries[indices[0]];
        if (!entry) return [];
        if (!entry.track) {
            return [{ label: "Remove from Playlist", icon: <RemoveIcon />, variant: "destructive", onClick: () => requestRemoveRows(indices) }];
        }
        const track = entry.track;
        return [
            ...queueActions.contextMenuItems(track),
            { separator: true, label: "", onClick: () => { } },
            { label: "Add to Playlist", icon: <AddToPlaylistIcon />, onClick: () => setTracksToAddToPlaylist([track]) },
            { label: "Remove from Playlist", icon: <RemoveIcon />, variant: "destructive", onClick: () => requestRemoveRows(indices) },
        ];
    };

    const handlePlayAll = () => {
        if (playableTracks.length > 0) {
            void playQueue(playableTracks, 0, { playlistId, sourceTrackIds: playlist?.trackIds });
            recordProductAnalyticsFromBrowser("playlist.played", {
                source: "playlist_detail",
                subjectType: "playlist",
                subjectId: playlistId,
                payload: {
                    playlistId,
                    startIndex: 0,
                    trackCount: playableTracks.length,
                },
            });
        }
    };

    // Global key listener for playback
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            // Space on a button or a menu item (the track menu) is theirs.
            if (e.target instanceof HTMLElement && e.target.closest('button, a, [role="menu"]')) return;

            const focused = rowSelection.selection.focus;
            if (e.code === "Space" && !e.ctrlKey && !e.metaKey && focused !== null) {
                e.preventDefault();
                playEntryRow(focused);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [rowSelection.selection.focus, playEntryRow]);

    const handleRename = async (newName: string) => {
        if (!newName.trim() || !playlist) {
            setShowRenameModal(false);
            return;
        }
        await renamePlaylist(playlist.id, newName.trim());
        setPlaylist({ ...playlist, name: newName.trim() });
        setShowRenameModal(false);
    };

    const handleInsertDrop = async (request: PlaylistAddRequest, toIndex: number) => {
        const name = playlist?.name || "playlist";
        try {
            const outcome = await applyPlaylistDrop(playlistId, request, toIndex);
            if (!outcome.ok) {
                addToast({ type: "error", title: `Couldn't add to ${name}`, message: "Sync your playlists and try again." });
                return;
            }
            addToast(playlistDropToast(outcome.playlist.name || name, outcome.requested, outcome.added, outcome.title));
            if (outcome.added > 0) await loadPlaylistData();
        } catch (err) {
            console.error("Drop failed", err);
            addToast({ type: "error", title: `Couldn't add to ${name}`, message: "Sync your playlists and try again." });
        }
    };

    const handleReorder = async (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || !playlist) return;

        const newTrackIds = [...playlist.trackIds];
        const [movedTrackId] = newTrackIds.splice(fromIndex, 1);

        // Adjust toIndex if it's after fromIndex
        const adjustedToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
        newTrackIds.splice(adjustedToIndex, 0, movedTrackId);

        await reorderTracks(playlistId, newTrackIds);
        await loadPlaylistData();
    };

    if (loading) {
        return <div className="detail-loading">Loading playlist...</div>;
    }

    if (!playlist) {
        return (
            <div className="detail-error">
                <p>Playlist not found</p>
                <Button onClick={onBack}>Back to Library</Button>
            </div>
        );
    }

    const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
    const heroArt = tracks.length > 0 ? artworkUrls.get(tracks[0].id) : null;
    const isLocalOnly = playlist.id.startsWith("playlist_");

    const rowStateClasses = (index: number) => [
        rowSelection.isSelected(index) ? "selected" : "",
        rowSelection.isFocused(index) ? "is-focused" : "",
        contextMenu?.row === index ? "menu-open" : "",
    ].filter(Boolean).join(" ");

    return (
        <div className="library-detail pl-owner">
            <div className="library-detail-back">
                <Button variant="ghost" onClick={onBack}>← Back to Playlists</Button>
            </div>

            <PlaylistHero
                artUrl={heroArt}
                name={playlist.name}
                onRename={() => setShowRenameModal(true)}
                label={
                    <>
                        <span className="pl-hero-kind">Playlist</span>
                        {playlist.visibility === "public" && (
                            <span className="pl-visibility-badge" title="Anyone with the link can listen">
                                Public
                            </span>
                        )}
                    </>
                }
                meta={
                    <>
                        {entries.length} track{entries.length !== 1 ? "s" : ""}
                        <PlaylistMetaDot />
                        {formatDuration(totalDuration)}
                        {playableTracks.length < entries.length && (
                            <>
                                <PlaylistMetaDot />
                                {entries.length - playableTracks.length} unavailable
                            </>
                        )}
                    </>
                }
                actions={
                    <>
                        <Button variant="primary" onClick={handlePlayAll} disabled={playableTracks.length === 0}>
                            <PlayIcon /> Play
                        </Button>
                        <QueueActionsButton
                            tracks={playableTracks}
                            label="Add to queue"
                            nextLabel="Play playlist next"
                            disabled={playableTracks.length === 0}
                        />
                        {/* Seeded AI DJ session (#2244): server playlists only, the server cannot read a local one. */}
                        {!isLocalOnly && (
                            <StartDjFromSeedButton seed={{ kind: "playlist", id: playlist.id, label: playlist.name }} />
                        )}
                        <PlaylistShareControl
                            playlistId={playlist.id}
                            visibility={playlist.visibility}
                            localOnly={isLocalOnly}
                            onVisibilityChange={(visibility: PlaylistVisibility) =>
                                setPlaylist((prev) => (prev ? { ...prev, visibility } : prev))
                            }
                        />
                    </>
                }
            />

            <div className="pl-tracks">
                <TrackSelectionBar
                    count={rowSelection.selected.length}
                    items={getSelectionItems(rowSelection.selected)}
                    onClear={rowSelection.clear}
                />
                {entries.length === 0 ? (
                    <div className="pl-public-empty-list">This playlist is empty. Add some tracks from your library!</div>
                ) : (
                    <div
                        ref={listRef}
                        className="library-list"
                        tabIndex={0}
                        aria-label="Playlist tracks. Shift or Ctrl-click to select several tracks. Shift+F10 opens a track's options."
                        {...rowSelection.listProps}
                    >
                        {entries.map((entry, index) => {
                            const track = entry.track;
                            const availability = resolveAvailability(track);

                            // The entry no longer resolves to anything. It keeps
                            // its place, says so, and can still be removed (#1793).
                            if (!track) {
                                return (
                                    <PlaylistTrackRow
                                        key={`${entry.id}-${index}`}
                                        index={index}
                                        title="Unavailable track"
                                        meta={<TrackUnavailableNote availability={availability} />}
                                        duration={undefined}
                                        playable={false}
                                        stateClassName={rowStateClasses(index)}
                                        tooltip={availability.reason ?? undefined}
                                        menu={rowMenuButton(index, "unavailable track")}
                                        {...rowSelection.rowProps(index)}
                                        onContextMenu={(e) => handleContextMenu(e, index)}
                                        aria-disabled="true"
                                    />
                                );
                            }

                            const progress = trackProgress.get(track.id);
                            const isStem = Boolean(track.stemType && track.stemType.toLowerCase() !== "original");

                            return (
                                <PlaylistTrackRow
                                    key={`${track.id}-${index}`}
                                    index={index}
                                    title={track.title}
                                    duration={track.duration}
                                    artUrl={artworkUrls.get(track.id)}
                                    artBadge={isStem ? (
                                        <div className="absolute top-0 right-0 bg-accent text-white text-[9px] px-1 py-0.5 rounded-bl font-bold shadow-md">
                                            STEM
                                        </div>
                                    ) : null}
                                    meta={
                                        <>
                                            <span
                                                className="clickable hover:underline"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const target = track.artist;
                                                    if (target) router.push(libraryArtistHref(target));
                                                }}
                                            >
                                                {track.artist || "Unknown Artist"}
                                            </span>
                                            {track.album && ` • ${track.album}`}
                                            {isStem && (
                                                <span className="text-accent text-xs ml-2 font-medium border border-accent/30 px-1.5 py-0.5 rounded-full">
                                                    {track.stemType}
                                                </span>
                                            )}
                                            <TrackUnavailableNote availability={availability} />
                                        </>
                                    }
                                    extra={progress !== undefined && progress < 100 ? (
                                        <div className="track-progress-container">
                                            <div className="track-progress-bar" style={{ width: `${progress}%` }} />
                                            <span className="track-progress-label">Separating Stems: {progress}%</span>
                                        </div>
                                    ) : null}
                                    isCurrent={currentTrack?.id === track.id}
                                    playable={availability.playable}
                                    reorderable
                                    menu={rowMenuButton(index, track.title)}
                                    stateClassName={[
                                        rowStateClasses(index),
                                        draggingTrackId === track.id ? "dragging" : "",
                                        dragOverIndex === index ? "drag-before" : "",
                                        dragOverIndex === index + 1 && index === entries.length - 1 ? "drag-after" : "",
                                    ].filter(Boolean).join(" ")}
                                    aria-disabled={availability.playable ? undefined : true}
                                    tooltip={availability.playable ? undefined : availability.reason ?? undefined}
                                    draggable
                                    {...rowSelection.rowProps(index)}
                                    onContextMenu={(e) => handleContextMenu(e, index)}
                                    onDragStart={(e) => {
                                        e.stopPropagation();
                                        setDraggingTrackId(track.id);
                                        const payload = JSON.stringify({ type: "reorder-track", playlistId, trackId: track.id, index });
                                        e.dataTransfer.setData("application/json", payload);
                                        e.dataTransfer.setData("text/plain", payload);
                                        e.dataTransfer.setData(playlistSourceType(playlistId), track.id);
                                        // Move within this playlist, copy onto another one.
                                        e.dataTransfer.effectAllowed = "copyMove";

                                        // Set a ghost image or just let it be
                                        if (e.currentTarget instanceof HTMLElement) {
                                            e.currentTarget.style.opacity = '0.4';
                                        }
                                    }}
                                    onDragEnd={(e) => {
                                        e.stopPropagation();
                                        setDraggingTrackId(null);
                                        setDragOverIndex(null);
                                        if (e.currentTarget instanceof HTMLElement) {
                                            e.currentTarget.style.opacity = '1';
                                        }
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.dataTransfer.dropEffect = playlistDropEffect(e.dataTransfer.effectAllowed, { types: e.dataTransfer.types, playlistId });

                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const midpoint = rect.top + rect.height / 2;
                                        if (e.clientY < midpoint) {
                                            if (dragOverIndex !== index) setDragOverIndex(index);
                                        } else {
                                            if (dragOverIndex !== index + 1) setDragOverIndex(index + 1);
                                        }
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setDragOverIndex(null);

                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const midpoint = rect.top + rect.height / 2;
                                        const finalToIndex = e.clientY < midpoint ? index : index + 1;

                                        // Rows of this playlist reorder; tracks from another
                                        // playlist or the library are inserted here.
                                        const request = playlistDropForTarget(
                                            parsePlaylistDropPayload(
                                                e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain"),
                                            ),
                                            playlistId,
                                        );
                                        if (!request) return;
                                        if (request.kind === "reorder") {
                                            void handleReorder(request.index, finalToIndex);
                                        } else {
                                            void handleInsertDrop(request, finalToIndex);
                                        }
                                    }}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={getTrackContextMenuItems(contextMenu.indices)}
                    onClose={() => setContextMenu(null)}
                    openerRef={contextMenu.opener ? { current: contextMenu.opener } : undefined}
                    ariaLabel={contextMenu.indices.length > 1 ? `Options for ${contextMenu.indices.length} tracks` : "Track options"}
                />
            )}

            <ConfirmDialog
                isOpen={pendingRemoval !== null}
                title={pendingRemoval?.length === 1
                    ? `Remove “${entries.find((entry) => entry.id === pendingRemoval[0])?.track?.title ?? "this track"}”?`
                    : `Remove ${pendingRemoval?.length ?? 0} tracks?`}
                message={pendingRemoval?.length === 1
                    ? "It is removed from this playlist only, not from your library."
                    : "They are removed from this playlist only, not from your library."}
                confirmLabel="Remove"
                variant="danger"
                onConfirm={confirmRemoveEntries}
                onCancel={() => setPendingRemoval(null)}
            />

            <PromptModal
                isOpen={showRenameModal}
                title="Rename Playlist"
                initialValue={playlist.name}
                onConfirm={handleRename}
                onCancel={() => setShowRenameModal(false)}
            />
        </div>
    );
}
