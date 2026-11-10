/**
 * "Has this page finished arriving?"
 *
 * Opening a page is the busiest moment it ever has: scripts run, data lands in
 * waves, images decode and the first screen is drawn several times over. Work
 * that can wait should not pile onto that moment. Two things use this signal:
 *
 * - the idle animation guard keeps decorative loops still until the page has
 *   settled, so the compositor is not also drawing a frame every vsync while
 *   the page loads (`idleAnimationGuard.ts`);
 * - `DeferredMount` starts below-the-fold widgets afterwards, one per idle
 *   period (`components/system/DeferredMount.tsx`).
 *
 * Settled means: the document has finished loading and nothing has been added
 * to it, and no image, font or stylesheet has finished loading, for `quietMs`.
 * `maxMs` caps the wait, so a page that never goes quiet (a slow API, a live
 * feed) still settles.
 *
 * Only added element nodes count as activity. Text that ticks (a clock, the
 * player's elapsed time) changes character data, not the tree, so it cannot
 * hold the page unsettled.
 *
 * DOM-agnostic for unit tests: pass a fake window, MutationObserver and timers.
 */

export const SETTLE_QUIET_MS = 1200;
export const SETTLE_MAX_MS = 8000;

type Timers = {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
};

type MutationRecordLike = { addedNodes?: ArrayLike<{ nodeType?: number }> };
type MutationObserverLike = { observe: (target: unknown, options: MutationObserverInit) => void; disconnect: () => void };
type MutationObserverCtor = new (callback: (records: MutationRecordLike[]) => void) => MutationObserverLike;

type SettleWindow = {
  document: {
    readyState: string;
    body?: unknown;
    documentElement?: unknown;
    addEventListener: (type: string, listener: () => void, options?: boolean | AddEventListenerOptions) => void;
    removeEventListener: (type: string, listener: () => void, options?: boolean | EventListenerOptions) => void;
  };
  addEventListener: (type: string, listener: () => void, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: () => void, options?: boolean | EventListenerOptions) => void;
};

export type PageSettleOptions = {
  win?: SettleWindow;
  MutationObserverCtor?: MutationObserverCtor;
  quietMs?: number;
  maxMs?: number;
  timers?: Timers;
};

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

const ELEMENT_NODE = 1;

/**
 * Calls `onSettled` once, when the page has settled. Returns a cleanup that
 * cancels the watch. Without a window (server render) it settles immediately.
 */
export function watchPageSettle(
  onSettled: () => void,
  {
    win,
    MutationObserverCtor: ObserverCtor,
    quietMs = SETTLE_QUIET_MS,
    maxMs = SETTLE_MAX_MS,
    timers = defaultTimers,
  }: PageSettleOptions = {},
): () => void {
  const target: SettleWindow | undefined =
    win ?? (typeof window === "undefined" ? undefined : (window as unknown as SettleWindow));
  if (!target) {
    onSettled();
    return () => {};
  }
  const Observer =
    ObserverCtor ??
    (typeof MutationObserver === "undefined" ? undefined : (MutationObserver as unknown as MutationObserverCtor));

  const startedAt = timers.now();
  let lastActivity = startedAt;
  let timer: unknown = null;
  let done = false;

  // Activity only records a timestamp; one pending timeout does the checking.
  const onActivity = () => {
    lastActivity = timers.now();
  };

  const observer = Observer
    ? new Observer((records) => {
        for (const record of records) {
          const added = record.addedNodes;
          if (!added) continue;
          for (let i = 0; i < added.length; i += 1) {
            if (added[i]?.nodeType === ELEMENT_NODE) {
              onActivity();
              return;
            }
          }
        }
      })
    : undefined;

  const stop = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    observer?.disconnect();
    // `load` does not bubble, but it can be captured on its way to an image,
    // stylesheet or script.
    target.document.removeEventListener("load", onActivity, true);
    target.removeEventListener("load", onLoaded);
  };

  function check() {
    if (done) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    const now = timers.now();
    const untilCap = maxMs - (now - startedAt);
    const loaded = target!.document.readyState === "complete";
    const untilQuiet = loaded ? quietMs - (now - lastActivity) : quietMs;
    if (untilCap <= 0 || (loaded && untilQuiet <= 0)) {
      done = true;
      stop();
      onSettled();
      return;
    }
    timer = timers.setTimeout(check, Math.max(1, Math.min(untilCap, untilQuiet)));
  }

  // Quiet time is counted from the end of loading, not from before it.
  function onLoaded() {
    onActivity();
    check();
  }

  const root = target.document.body ?? target.document.documentElement;
  if (observer && root) observer.observe(root, { childList: true, subtree: true });
  target.document.addEventListener("load", onActivity, true);
  target.addEventListener("load", onLoaded);
  check();

  return () => {
    if (done) return;
    done = true;
    stop();
  };
}

let settled: Promise<void> | null = null;
let hasSettled = false;

/**
 * Resolves once the page this module was loaded on has settled. One watch per
 * page load, shared by every caller; client-side route changes do not reset
 * it, because the application shell is already up by then.
 */
export function whenPageSettled(): Promise<void> {
  settled ??= new Promise<void>((resolve) => {
    watchPageSettle(() => {
      hasSettled = true;
      resolve();
    });
  });
  return settled;
}

/** True once `whenPageSettled()` has resolved. Synchronous, for render paths. */
export function isPageSettled(): boolean {
  return hasSettled;
}

type IdleWindow = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** A deferred task waits at most this long for an idle period once the page has settled. */
const IDLE_TIMEOUT_MS = 1500;

const idleQueue: Array<{ run: () => void }> = [];
let draining = false;

function drainIdleQueue() {
  const next = idleQueue.shift();
  if (!next) {
    draining = false;
    return;
  }
  draining = true;
  const step = () => {
    try {
      next.run();
    } finally {
      drainIdleQueue();
    }
  };
  const idle = globalThis as unknown as IdleWindow;
  if (typeof idle.requestIdleCallback === "function") idle.requestIdleCallback(step, { timeout: IDLE_TIMEOUT_MS });
  else globalThis.setTimeout(step, 50);
}

/**
 * Runs `task` after the page has settled, in the order tasks were queued and
 * one per idle period, so work that was moved out of the load does not come
 * back as a second burst. Returns a cancel function.
 */
export function runWhenSettledAndIdle(task: () => void): () => void {
  const entry = { run: task };
  idleQueue.push(entry);
  void whenPageSettled().then(() => {
    if (!draining) drainIdleQueue();
  });
  return () => {
    const index = idleQueue.indexOf(entry);
    if (index >= 0) idleQueue.splice(index, 1);
    else entry.run = () => {};
  };
}
