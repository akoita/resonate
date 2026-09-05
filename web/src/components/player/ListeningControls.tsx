"use client";
import { useState } from "react";
import { usePlayer } from "../../lib/playerContext";

export function ListeningControls() {
  const { currentTrack, currentTime, duration, segmentLoop, setSegmentLoop, clearSegmentLoop,
    finiteRepeat, setFiniteRepeat, clearFiniteRepeat } = usePlayer();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [target, setTarget] = useState<"track" | "queue">("track");
  const [count, setCount] = useState("1");
  const [error, setError] = useState("");
  const knownDuration = Number.isFinite(duration) && duration > 0;
  if (!currentTrack) return null;
  return <details className="listening-controls">
    <summary>Loop and repeat{segmentLoop ? " · A–B on" : ""}{finiteRepeat ? ` · ${finiteRepeat.remaining} repeats left` : ""}</summary>
    <fieldset>
      <legend>Loop a passage</legend>
      <label>A (seconds)<input type="number" min="0" max={knownDuration ? duration : undefined} step="0.1" value={start} onChange={e => setStart(e.target.value)} /></label>
      <button type="button" disabled={!knownDuration} onClick={() => setStart(currentTime.toFixed(1))}>Set A here</button>
      <label>B (seconds)<input type="number" min="0" max={knownDuration ? duration : undefined} step="0.1" value={end} onChange={e => setEnd(e.target.value)} /></label>
      <button type="button" disabled={!knownDuration} onClick={() => setEnd(currentTime.toFixed(1))}>Set B here</button>
      <button type="button" disabled={!knownDuration} onClick={() => {
        setError(start !== "" && end !== "" && setSegmentLoop(Number(start), Number(end)) ? "" : "Choose A before B within this track.");
      }}>{segmentLoop ? "Update passage" : "Loop passage"}</button>
      <button type="button" disabled={!segmentLoop} onClick={clearSegmentLoop}>Clear passage</button>
      {!knownDuration && <p>Loop controls become available when the track duration is known.</p>}
      {segmentLoop && <p role="status">Looping {segmentLoop.start.toFixed(1)}–{segmentLoop.end.toFixed(1)} seconds ({(segmentLoop.end - segmentLoop.start).toFixed(1)} seconds). Seeking stays inside this passage.</p>}
    </fieldset>
    <fieldset>
      <legend>Repeat a chosen number of times</legend>
      <label>Repeat target<select value={target} onChange={e => setTarget(e.target.value as "track" | "queue")}><option value="track">Current track</option><option value="queue">Entire queue</option></select></label>
      <label>Additional repeats<input type="number" min="1" step="1" value={count} onChange={e => setCount(e.target.value)} /></label>
      <button type="button" onClick={() => setError(setFiniteRepeat(target, Number(count)) ? "" : "Enter a positive whole number of additional repeats.")}>{finiteRepeat ? "Update repeats" : "Set repeats"}</button>
      <button type="button" disabled={!finiteRepeat} onClick={clearFiniteRepeat}>Cancel repeats</button>
      {finiteRepeat && <p role="status">{finiteRepeat.target === "track" ? "Track" : "Queue"}: {finiteRepeat.configured} additional repeats configured, {finiteRepeat.remaining} remaining.{segmentLoop ? " Counting waits while the passage loops." : ""}</p>}
    </fieldset>
    {error && <p role="alert">{error}</p>}
  </details>;
}
