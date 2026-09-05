"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ApiRequestError } from "../../lib/api";
import { usePlayer } from "../../lib/playerContext";
import type { LocalTrack } from "../../lib/localLibrary";
import { queueSnapshot } from "../../lib/listeningSession";
import { createQueuePlaylist, listFolders, type PlaylistFolder } from "../../lib/playlistStore";
import { useFocusContainment } from "../ui/useFocusContainment";

/** Matches the stroke weight and 17px box of the Now Playing action icons. */
function QueueSaveIcon() {
  return <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="3" y1="6" x2="14" y2="6" /><line x1="3" y1="12" x2="14" y2="12" /><line x1="3" y1="18" x2="10" y2="18" />
    <line x1="18" y1="9" x2="18" y2="19" /><polyline points="15 16 18 19 21 16" />
  </svg>;
}

export function SaveQueuePlaylist() {
  const { queue, queueSource, queueSourceKind } = usePlayer();
  const [snapshot, setSnapshot] = useState<ReturnType<typeof queueSnapshot> & { tracks: LocalTrack[]; queueCount: number; sourceKind: "ad_hoc" | "modified_playlist" } | null>(null);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [folders, setFolders] = useState<PlaylistFolder[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = () => { if (!inFlight.current) setSnapshot(null); };
  useFocusContainment({ active: !!snapshot, containerRef: dialog, initialFocusRef: input, onEscape: close });
  async function save() {
    if (!snapshot || inFlight.current || !name.trim() || !snapshot.trackIds.length || (snapshot.invalid.length > 0 && !confirmed)) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const playlist = await createQueuePlaylist(name, folder || null, snapshot.trackIds, {
        sourceKind: snapshot.sourceKind, queueCount: snapshot.queueCount, omittedCount: snapshot.invalid.length,
      }, snapshot.tracks);
      setSaved(playlist.id); setSnapshot(null);
    } catch (e) {
      if (e instanceof ApiRequestError && e.details && typeof e.details === "object" && "invalidTrackIds" in e.details && Array.isArray(e.details.invalidTrackIds)) {
        const invalidIds = new Set(e.details.invalidTrackIds.filter((id): id is string => typeof id === "string"));
        const unavailable = snapshot.tracks.filter(track => invalidIds.has(track.catalogTrackId || track.id));
        setSnapshot({ ...snapshot, trackIds: snapshot.trackIds.filter(id => !invalidIds.has(id)), invalid: [...snapshot.invalid, ...unavailable] });
        setConfirmed(false);
      }
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="listening-controls queue-save">
    {/* Same chip grammar as the Now Playing action row directly above it. */}
    {queue.length > 0 && (queueSourceKind === "unchanged_playlist" && queueSource
      ? <Link className="player-action-chip player-action-chip--available" href={queueSource.publicPlaylist ? `/playlist/${encodeURIComponent(queueSource.playlistId)}` : `/library?tab=playlists&playlist=${encodeURIComponent(queueSource.playlistId)}`}><QueueSaveIcon />View playlist</Link>
      : <button type="button" className="player-action-chip player-action-chip--available" onClick={() => {
        setSnapshot({ ...queueSnapshot(queue), tracks: [...queue], queueCount: queue.length, sourceKind: queueSourceKind === "modified_playlist" ? "modified_playlist" : "ad_hoc" });
        setName(""); setFolder(""); setConfirmed(false); setError(""); setSaved(null);
        void listFolders().then(setFolders).catch(() => setError("Could not load folders. You can still save in the root folder."));
      }}><QueueSaveIcon />Save queue as playlist</button>)}
    {saved && <p className="lc-status" role="status">Playlist saved. <Link href={`/library?tab=playlists&playlist=${encodeURIComponent(saved)}`}>Open playlist</Link></p>}
    {snapshot && createPortal(<div className="playlist-modal-overlay">
      <div className="playlist-modal redesigned listening-dialog listening-controls" ref={dialog} role="dialog" aria-modal="true" aria-label="Save queue as playlist">
        <h2>Save queue as playlist</h2>
        <p>Save {snapshot.trackIds.length} tracks in queue order. Your playlist is private by default.</p>
        {snapshot.queueCount > snapshot.trackIds.length + snapshot.invalid.length && <p>Repeated copies of the same track are saved once, in their first position.</p>}
        <label>Name<input ref={input} value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
        <label>Folder<select value={folder} onChange={e => setFolder(e.target.value)} disabled={busy}>
          <option value="">Root folder</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></label>
        {snapshot.invalid.length > 0 && <div className="lc-omitted">
          <p>These tracks cannot be saved:</p><ul>{snapshot.invalid.map(t => <li key={t.id}>{t.title}</li>)}</ul>
          {!!snapshot.trackIds.length && <label className="lc-checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Save without these tracks</label>}
        </div>}
        {error && <p className="lc-error" role="alert">{error}</p>}
        <div className="lc-actions lc-actions--dialog">
          <button type="button" className="lc-btn lc-btn--ghost" disabled={busy} onClick={close}>Cancel</button>
          <button type="button" className="lc-btn lc-btn--primary" disabled={busy || !name.trim() || !snapshot.trackIds.length || (snapshot.invalid.length > 0 && !confirmed)} onClick={() => void save()}>{busy ? "Saving…" : "Create playlist"}</button>
        </div>
      </div>
    </div>, document.body)}
  </div>;
}
