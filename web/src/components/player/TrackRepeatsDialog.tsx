"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePlayer } from "../../lib/playerContext";
import type { LocalTrack } from "../../lib/localLibrary";
import { Button } from "../ui/Button";
import { useFocusContainment } from "../ui/useFocusContainment";
import { useToast } from "../ui/Toast";

const MAX_REPEATS = 99;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * "Set repeats…" from any track menu. The Loop and Repeat panel only reaches
 * the track that is playing; this sets additional repeats for any track. A
 * track that is not playing keeps its count until it next starts, then the
 * count runs exactly like one set from the panel.
 */
export function TrackRepeatsDialog({ track, onClose }: { track: LocalTrack | null; onClose: () => void }) {
  const { currentTrack, finiteRepeat, setTrackRepeats, trackRepeatsFor } = usePlayer();
  const { addToast } = useToast();
  const [value, setValue] = useState("1");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId().replace(/:/g, "");
  const existing = track ? trackRepeatsFor(track) : 0;
  const isCurrent = !!track && !!currentTrack && (currentTrack.id === track.id
    || (!!track.catalogTrackId && currentTrack.catalogTrackId === track.catalogTrackId));

  useEffect(() => {
    if (!track) return;
    setValue(String(existing || 1));
    setError("");
    // Seed only when the dialog opens for a track, not on every countdown tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  useFocusContainment({ active: !!track, containerRef: dialogRef, initialFocusRef: inputRef, onEscape: onClose });

  if (!track) return null;

  const parsed = Number(value);
  const valid = value !== "" && Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_REPEATS;
  const step = (delta: number) => {
    const base = Number.isSafeInteger(parsed) ? parsed : 1;
    setValue(String(Math.min(MAX_REPEATS, Math.max(1, base + delta))));
    setError("");
  };

  const apply = (count: number) => {
    if (!setTrackRepeats(track, count)) {
      setError(`Enter a whole number from 1 to ${MAX_REPEATS}.`);
      return;
    }
    addToast(count === 0
      ? { type: "info", title: "Repeats cancelled", message: track.title }
      : {
        type: "success",
        title: `${plural(count, "additional repeat")} set`,
        message: isCurrent ? `${track.title} repeats from now.` : `${track.title} repeats the next time it plays.`,
      });
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setError(`Enter a whole number from 1 to ${MAX_REPEATS}.`);
      return;
    }
    apply(parsed);
  };

  const queueRepeatOn = !isCurrent && finiteRepeat?.target === "queue";

  return (
    <div className="playlist-modal-overlay" style={{ zIndex: 2000 }} onClick={onClose}>
      <div
        className="playlist-modal redesigned"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-desc`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "400px" }}
      >
        <form onSubmit={submit}>
          <div className="playlist-modal-header" style={{ paddingBottom: "16px" }}>
            <h3 id={`${ids}-title`} style={{ fontSize: "20px" }}>Set repeats</h3>
            <p id={`${ids}-desc`} className="text-sm text-white/50 mt-1">
              {track.title}{track.artist ? ` · ${track.artist}` : ""}.{" "}
              {isCurrent ? "Playing now, so the count starts right away." : "The count starts the next time this track plays."}
            </p>
          </div>
          <div style={{ padding: "24px 32px" }}>
            <label htmlFor={`${ids}-count`} className="text-sm text-white/70">Additional repeats</label>
            <div className="track-repeats-stepper">
              <button type="button" className="track-repeats-step" aria-label="Fewer repeats" disabled={valid && parsed <= 1} onClick={() => step(-1)}>−</button>
              <input
                ref={inputRef}
                id={`${ids}-count`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_REPEATS}
                step={1}
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(""); }}
                className="playlist-search-input track-repeats-input"
              />
              <button type="button" className="track-repeats-step" aria-label="More repeats" disabled={valid && parsed >= MAX_REPEATS} onClick={() => step(1)}>+</button>
            </div>
            {existing > 0 && (
              <p className="text-sm text-white/50 mt-2" role="status">
                {isCurrent ? `${plural(existing, "repeat")} left now.` : `${plural(existing, "repeat")} already set.`}
              </p>
            )}
            {queueRepeatOn && (
              <p className="text-sm text-white/50 mt-2">A queue repeat is on. This count waits until the queue repeat ends.</p>
            )}
            {error && <p className="text-sm mt-2" style={{ color: "var(--color-error, #f87171)" }} role="alert">{error}</p>}
          </div>
          <div className="playlist-modal-footer flex gap-3">
            {existing > 0
              ? <Button type="button" variant="ghost" onClick={() => apply(0)} className="flex-1">Cancel repeats</Button>
              : <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Close</Button>}
            <Button type="submit" className="flex-1" style={{ background: "var(--color-accent)", color: "white", border: "none" }}>
              {existing > 0 ? "Update" : "Set repeats"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
