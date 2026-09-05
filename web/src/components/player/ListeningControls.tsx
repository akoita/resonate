"use client";
import { useId, useState } from "react";
import { usePlayer } from "../../lib/playerContext";

/** Console copy shows clock time; the fields stay in seconds so a passage can be set to a tenth. */
function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
/** Rack readouts never go blank; an empty or out-of-range field parks at --:--. */
function readout(value: string, knownDuration: boolean, duration: number) {
  const parsed = Number(value);
  if (value === "" || !Number.isFinite(parsed) || parsed < 0) return "--:--";
  if (knownDuration && parsed > duration) return "--:--";
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
  const ids = useId();
  const knownDuration = Number.isFinite(duration) && duration > 0;
  if (!currentTrack) return null;
  return <details className="listening-controls">
    {/* Reads as another console module: mono kicker, status LEDs, hairline rules — not a boxed form. */}
    <summary className="lc-kicker-row">
      <span className="studio-label">Loop and Repeat</span>
      <span className="lc-leds">
        {segmentLoop && <span className="lc-led-chip"><span className="lc-led" aria-hidden="true" />A–B on</span>}
        {finiteRepeat && <span className="lc-led-chip"><span className="lc-led" aria-hidden="true" />{plural(finiteRepeat.remaining, "repeat")} left</span>}
      </span>
      <span className="lc-caret" aria-hidden="true" />
    </summary>
    <div className="lc-body">
      <fieldset className="lc-group">
        <legend className="studio-label">Passage Loop</legend>
        <div className="lc-rack">
          <label className="lc-designator" htmlFor={`${ids}-a`}>A<span className="visually-hidden"> (seconds)</span></label>
          <span className="lc-well">
            <input id={`${ids}-a`} type="number" min="0" max={knownDuration ? duration : undefined} step="0.1" value={start} onChange={e => setStart(e.target.value)} />
            <span className="lc-unit" aria-hidden="true">s</span>
          </span>
          <button type="button" className="lc-chip" disabled={!knownDuration} onClick={() => setStart(currentTime.toFixed(1))}>Set A here</button>
          <span className="lc-readout" aria-hidden="true">{readout(start, knownDuration, duration)}</span>
        </div>
        <div className="lc-rack">
          <label className="lc-designator" htmlFor={`${ids}-b`}>B<span className="visually-hidden"> (seconds)</span></label>
          <span className="lc-well">
            <input id={`${ids}-b`} type="number" min="0" max={knownDuration ? duration : undefined} step="0.1" value={end} onChange={e => setEnd(e.target.value)} />
            <span className="lc-unit" aria-hidden="true">s</span>
          </span>
          <button type="button" className="lc-chip" disabled={!knownDuration} onClick={() => setEnd(currentTime.toFixed(1))}>Set B here</button>
          <span className="lc-readout" aria-hidden="true">{readout(end, knownDuration, duration)}</span>
        </div>
        <div className="lc-row">
          <button type="button" className={`lc-chip ${segmentLoop ? "lc-chip--armed" : "lc-chip--arm"}`} disabled={!knownDuration} onClick={() => {
            setSegmentError(start !== "" && end !== "" && setSegmentLoop(Number(start), Number(end)) ? "" : "Choose A before B within this track.");
          }}>{segmentLoop ? "Update passage" : "Loop passage"}</button>
          <button type="button" className="lc-chip" disabled={!segmentLoop} onClick={() => { clearSegmentLoop(); setSegmentError(""); }}>Clear passage</button>
        </div>
        {!knownDuration && <p className="lc-note">Loop controls become available when the track duration is known.</p>}
        {segmentLoop && <p className="lc-note" role="status">Looping {clock(segmentLoop.start)}–{clock(segmentLoop.end)} ({(segmentLoop.end - segmentLoop.start).toFixed(1)} seconds). Seeking stays inside this passage.</p>}
        {segmentError && <p className="lc-error" role="alert">{segmentError}</p>}
      </fieldset>
      <fieldset className="lc-group">
        <legend className="studio-label">Repeat Count</legend>
        <div className="lc-rack">
          <label className="lc-designator lc-designator--wide" htmlFor={`${ids}-target`}>Repeat target</label>
          <span className="lc-well lc-well--select">
            <select id={`${ids}-target`} value={target} onChange={e => setTarget(e.target.value as "track" | "queue")}>
              <option value="track">Current track</option>
              <option value="queue">Entire queue</option>
            </select>
            <span className="lc-chevron" aria-hidden="true" />
          </span>
        </div>
        <div className="lc-rack">
          <label className="lc-designator lc-designator--wide" htmlFor={`${ids}-count`}>Additional repeats</label>
          <span className="lc-well">
            <input id={`${ids}-count`} type="number" min="1" step="1" value={count} onChange={e => setCount(e.target.value)} />
            <span className="lc-unit" aria-hidden="true">×</span>
          </span>
        </div>
        <div className="lc-row">
          <button type="button" className={`lc-chip ${finiteRepeat ? "lc-chip--armed" : "lc-chip--arm"}`} onClick={() => setRepeatError(setFiniteRepeat(target, Number(count)) ? "" : "Enter a positive whole number of additional repeats.")}>{finiteRepeat ? "Update repeats" : "Set repeats"}</button>
          <button type="button" className="lc-chip" disabled={!finiteRepeat} onClick={() => { clearFiniteRepeat(); setRepeatError(""); }}>Cancel repeats</button>
        </div>
        {finiteRepeat && <p className="lc-note" role="status">{finiteRepeat.target === "track" ? "Track" : "Queue"}: {plural(finiteRepeat.configured, "additional repeat")} configured, {finiteRepeat.remaining} remaining.{segmentLoop ? " Counting waits while the passage loops." : ""}</p>}
        {repeatError && <p className="lc-error" role="alert">{repeatError}</p>}
      </fieldset>
    </div>
  </details>;
}
