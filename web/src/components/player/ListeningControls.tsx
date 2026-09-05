"use client";
import { useState } from "react";
import { usePlayer } from "../../lib/playerContext";

/** Console copy shows clock time; the inputs stay in seconds so a passage can be set to a tenth. */
function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
function hint(value: string, knownDuration: boolean, duration: number) {
  const parsed = Number(value);
  if (value === "" || !Number.isFinite(parsed) || parsed < 0) return "";
  if (knownDuration && parsed > duration) return "past the end";
  return clock(parsed);
}
function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function ListeningControls() {
  const { currentTrack, currentTime, duration, segmentLoop, setSegmentLoop, clearSegmentLoop,
    finiteRepeat, setFiniteRepeat, clearFiniteRepeat } = usePlayer();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [target, setTarget] = useState<"track" | "queue">("track");
  const [count, setCount] = useState("1");
  const [segmentError, setSegmentError] = useState("");
  const [repeatError, setRepeatError] = useState("");
  const knownDuration = Number.isFinite(duration) && duration > 0;
  if (!currentTrack) return null;
  return <details className="listening-controls">
    <summary className="lc-summary">
      <span className="lc-summary-title">Loop and repeat</span>
      {segmentLoop && <span className="lc-badge">A–B on</span>}
      {finiteRepeat && <span className="lc-badge">{plural(finiteRepeat.remaining, "repeat")} left</span>}
    </summary>
    <div className="lc-body">
      <fieldset className="lc-group">
        <legend>Loop a passage</legend>
        <div className="lc-fields">
          <div className="lc-field">
            <label>A (seconds)<input type="number" min="0" max={knownDuration ? duration : undefined} step="0.1" value={start} onChange={e => setStart(e.target.value)} /></label>
            <button type="button" className="lc-btn lc-btn--ghost" disabled={!knownDuration} onClick={() => setStart(currentTime.toFixed(1))}>Set A here</button>
            {hint(start, knownDuration, duration) && <span className="lc-hint" aria-hidden="true">{hint(start, knownDuration, duration)}</span>}
          </div>
          <div className="lc-field">
            <label>B (seconds)<input type="number" min="0" max={knownDuration ? duration : undefined} step="0.1" value={end} onChange={e => setEnd(e.target.value)} /></label>
            <button type="button" className="lc-btn lc-btn--ghost" disabled={!knownDuration} onClick={() => setEnd(currentTime.toFixed(1))}>Set B here</button>
            {hint(end, knownDuration, duration) && <span className="lc-hint" aria-hidden="true">{hint(end, knownDuration, duration)}</span>}
          </div>
        </div>
        <div className="lc-actions">
          <button type="button" className="lc-btn lc-btn--primary" disabled={!knownDuration} onClick={() => {
            setSegmentError(start !== "" && end !== "" && setSegmentLoop(Number(start), Number(end)) ? "" : "Choose A before B within this track.");
          }}>{segmentLoop ? "Update passage" : "Loop passage"}</button>
          <button type="button" className="lc-btn lc-btn--ghost" disabled={!segmentLoop} onClick={() => { clearSegmentLoop(); setSegmentError(""); }}>Clear passage</button>
        </div>
        {!knownDuration && <p className="lc-note">Loop controls become available when the track duration is known.</p>}
        {segmentLoop && <p className="lc-status" role="status">Looping {clock(segmentLoop.start)}–{clock(segmentLoop.end)} ({(segmentLoop.end - segmentLoop.start).toFixed(1)} seconds). Seeking stays inside this passage.</p>}
        {segmentError && <p className="lc-error" role="alert">{segmentError}</p>}
      </fieldset>
      <fieldset className="lc-group">
        <legend>Repeat a chosen number of times</legend>
        <div className="lc-fields">
          <div className="lc-field">
            <label>Repeat target<select value={target} onChange={e => setTarget(e.target.value as "track" | "queue")}><option value="track">Current track</option><option value="queue">Entire queue</option></select></label>
          </div>
          <div className="lc-field">
            <label>Additional repeats<input type="number" min="1" step="1" value={count} onChange={e => setCount(e.target.value)} /></label>
          </div>
        </div>
        <div className="lc-actions">
          <button type="button" className="lc-btn lc-btn--primary" onClick={() => setRepeatError(setFiniteRepeat(target, Number(count)) ? "" : "Enter a positive whole number of additional repeats.")}>{finiteRepeat ? "Update repeats" : "Set repeats"}</button>
          <button type="button" className="lc-btn lc-btn--ghost" disabled={!finiteRepeat} onClick={() => { clearFiniteRepeat(); setRepeatError(""); }}>Cancel repeats</button>
        </div>
        {finiteRepeat && <p className="lc-status" role="status">{finiteRepeat.target === "track" ? "Track" : "Queue"}: {plural(finiteRepeat.configured, "additional repeat")} configured, {finiteRepeat.remaining} remaining.{segmentLoop ? " Counting waits while the passage loops." : ""}</p>}
        {repeatError && <p className="lc-error" role="alert">{repeatError}</p>}
      </fieldset>
    </div>
  </details>;
}
