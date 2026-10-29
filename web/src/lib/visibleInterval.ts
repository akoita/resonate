/**
 * Visibility-aware intervals (#2436).
 *
 * A plain `setInterval` keeps polling, re-rendering, and hitting the network
 * while the tab sits in the background for hours. `registerVisibleInterval`
 * runs `callback` every `intervalMs` while the document is visible and, while
 * it is hidden, either pauses (the default) or backs off to `hiddenIntervalMs`.
 * When the tab becomes visible again it runs once right away (unless
 * `runOnVisible` is false) and resumes the visible cadence.
 *
 * The helper is DOM-agnostic so it can be unit-tested with fake timers. In a
 * React component, call it inside an effect and return the cleanup it gives.
 */

export type VisibilityTarget = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

export type VisibleIntervalOptions = {
  /**
   * Cadence while the tab is hidden. `null` (the default) pauses entirely; a
   * number keeps a slower heartbeat for work that must continue in the
   * background (e.g. remote playback control while audio plays).
   */
  hiddenIntervalMs?: number | null;
  /** Run once as soon as the tab becomes visible again. Default true. */
  runOnVisible?: boolean;
  /** Defaults to `document`. */
  visibilityTarget?: VisibilityTarget;
};

export function registerVisibleInterval(
  callback: () => void,
  intervalMs: number,
  { hiddenIntervalMs = null, runOnVisible = true, visibilityTarget }: VisibleIntervalOptions = {},
): () => void {
  const target = visibilityTarget ?? (typeof document === "undefined" ? null : document);
  let timer: ReturnType<typeof setInterval> | null = null;
  let active = true;

  const isHidden = () => target?.visibilityState === "hidden";
  const schedule = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    const delay = isHidden() ? hiddenIntervalMs : intervalMs;
    if (delay !== null && delay > 0) timer = setInterval(callback, delay);
  };
  const onVisibilityChange = () => {
    if (!active) return;
    schedule();
    if (runOnVisible && !isHidden()) callback();
  };

  schedule();
  target?.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    active = false;
    if (timer !== null) clearInterval(timer);
    target?.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
