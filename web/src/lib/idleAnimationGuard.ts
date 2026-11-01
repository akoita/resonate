/**
 * Idle animation guard (#2436).
 *
 * Decorative `infinite` CSS animations keep producing frames (and firing
 * `animationiteration` on the main thread) when nobody can see them: when the
 * element is scrolled out of view, or when the tab is in the background. The
 * guard finds every element that runs an infinite animation and marks it with
 * `data-idle-paused` while it is off-screen or the tab is hidden. A rule in
 * `globals.css` turns that attribute into `animation-play-state: paused` for
 * the element and its `::before`/`::after`.
 *
 * It also holds them once nobody has touched the page for `idleAfterMs`
 * (pointer, keyboard, wheel, touch or scroll). One running loop, however
 * small, makes the compositor draw a new frame every vsync, and each frame
 * re-composites every `backdrop-filter` surface on screen. A laptop measured
 * the GPU process at ~97% on an untouched Home page with the player paused;
 * with the loops held it drops to a few percent. Any input resumes them, so
 * someone using the page sees exactly the same motion. Loading indicators
 * (spinners, shimmers, skeletons) keep running while the user is idle, because
 * a frozen spinner reads as a hang.
 *
 * Why an attribute rather than `Animation.pause()`: a WAAPI pause overrides
 * the stylesheet until `play()` is called, so resuming would also override a
 * component's own CSS pause (the player marquee holds still while playback is
 * paused). The attribute composes with CSS: removing it hands control back.
 *
 * Only elements that run an infinite animation are marked, so one-shot
 * entrance/exit animations keep their timing. Elements are found once at
 * start-up and then through `animationstart`, which bubbles from every CSS
 * animation (pseudo-elements report their host element).
 *
 * The module is DOM-agnostic for unit tests: pass a fake document and
 * IntersectionObserver constructor.
 */

export const IDLE_PAUSED_ATTRIBUTE = "data-idle-paused";

/** Resume a little before an element scrolls back in, so it never starts visibly frozen. */
const ROOT_MARGIN = "96px";

/** How long the page must go untouched before decorative loops are held. */
export const DEFAULT_IDLE_AFTER_MS = 20_000;

/** Input that counts as someone using the page. Listened to in the capture phase. */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

/** Animation names that signal work in progress; these keep running while the user is idle. */
const LOADING_ANIMATION = /spin|shimmer|skeleton|loading|progress/i;

type AnimationLike = {
  animationName?: string;
  effect?: { target?: Element | null; getTiming?: () => { iterations?: number | null } } | null;
};

type GuardDocument = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> & {
  getAnimations?: () => AnimationLike[];
};

type ObserverLike = Pick<IntersectionObserver, "observe" | "unobserve" | "disconnect">;
type ObserverCtor = new (
  callback: (entries: Pick<IntersectionObserverEntry, "target" | "isIntersecting">[]) => void,
  options?: IntersectionObserverInit,
) => ObserverLike;

type Timers = {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
};

export type IdleAnimationGuardOptions = {
  doc?: GuardDocument;
  IntersectionObserverCtor?: ObserverCtor;
  /** Hold decorative loops after this long without input. 0 or less disables it. */
  idleAfterMs?: number;
  timers?: Timers;
};

function isInfinite(animation: AnimationLike): boolean {
  return animation.effect?.getTiming?.().iterations === Infinity;
}

/** Infinite animations on the element itself or its own ::before/::after. */
function ownInfiniteAnimations(element: Element): AnimationLike[] {
  const getAnimations = (element as Element & { getAnimations?: (o?: { subtree?: boolean }) => AnimationLike[] })
    .getAnimations;
  if (typeof getAnimations !== "function") return [];
  // `subtree` includes the element's own ::before/::after; keep only those
  // whose target is this element (descendants are tracked on their own).
  return getAnimations
    .call(element, { subtree: true })
    .filter((animation) => animation.effect?.target === element && isInfinite(animation));
}

function hasInfiniteAnimation(element: Element): boolean {
  return ownInfiniteAnimations(element).length > 0;
}

/** True when every loop on the element is a loading indicator. */
function isLoadingIndicator(element: Element): boolean {
  const loops = ownInfiniteAnimations(element);
  return loops.length > 0 && loops.every((animation) => LOADING_ANIMATION.test(animation.animationName ?? ""));
}

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** Start the guard. Returns a cleanup that removes every listener and mark. */
export function startIdleAnimationGuard({
  doc,
  IntersectionObserverCtor,
  idleAfterMs = DEFAULT_IDLE_AFTER_MS,
  timers = defaultTimers,
}: IdleAnimationGuardOptions = {}): () => void {
  const target: GuardDocument | undefined =
    doc ?? (typeof document === "undefined" ? undefined : (document as unknown as GuardDocument));
  const Observer =
    IntersectionObserverCtor ??
    (typeof IntersectionObserver === "undefined" ? undefined : (IntersectionObserver as unknown as ObserverCtor));
  if (!target) return () => {};

  const tracked = new Set<Element>();
  const offscreen = new WeakSet<Element>();
  const keepWhileIdle = new WeakSet<Element>();
  let tabHidden = target.visibilityState === "hidden";
  let userIdle = false;

  const apply = (element: Element) => {
    const hold = tabHidden || offscreen.has(element) || (userIdle && !keepWhileIdle.has(element));
    if (hold) element.setAttribute(IDLE_PAUSED_ATTRIBUTE, "");
    else element.removeAttribute(IDLE_PAUSED_ATTRIBUTE);
  };

  const forget = (element: Element) => {
    tracked.delete(element);
    observer?.unobserve(element);
    element.removeAttribute(IDLE_PAUSED_ATTRIBUTE);
  };

  const observer = Observer
    ? new Observer(
        (entries) => {
          for (const entry of entries) {
            const element = entry.target;
            if (!tracked.has(element)) continue;
            // A removed element reports "not intersecting" once; drop it then.
            if (!element.isConnected) {
              forget(element);
              continue;
            }
            if (entry.isIntersecting) offscreen.delete(element);
            else offscreen.add(element);
            apply(element);
          }
        },
        { rootMargin: ROOT_MARGIN },
      )
    : undefined;

  const track = (element: Element | null | undefined) => {
    if (!element || tracked.has(element)) return;
    tracked.add(element);
    if (isLoadingIndicator(element)) keepWhileIdle.add(element);
    observer?.observe(element);
    apply(element);
  };

  const onAnimationStart = (event: Event) => {
    const element = event.target as Element | null;
    if (element && hasInfiniteAnimation(element)) track(element);
  };

  // A loop removed by a class change cancels; stop tracking the element so the
  // mark cannot hold a later one-shot animation on it.
  const onAnimationCancel = (event: Event) => {
    const element = event.target as Element | null;
    if (element && tracked.has(element) && !hasInfiniteAnimation(element)) forget(element);
  };

  const applyAll = () => {
    for (const element of tracked) {
      if (!element.isConnected) forget(element);
      else apply(element);
    }
  };

  const onVisibilityChange = () => {
    tabHidden = target.visibilityState === "hidden";
    applyAll();
  };

  // User-idle detection: one pending timeout at a time. Input only records a
  // timestamp, so a stream of pointermove events costs a property write each.
  const idleEnabled = idleAfterMs > 0;
  let lastInput = timers.now();
  let idleTimer: unknown = null;
  const checkIdle = () => {
    idleTimer = null;
    const remaining = idleAfterMs - (timers.now() - lastInput);
    if (remaining > 0) {
      idleTimer = timers.setTimeout(checkIdle, remaining);
      return;
    }
    userIdle = true;
    applyAll();
  };
  const onActivity = () => {
    lastInput = timers.now();
    if (userIdle) {
      userIdle = false;
      applyAll();
    }
    if (idleTimer === null) idleTimer = timers.setTimeout(checkIdle, idleAfterMs);
  };

  for (const animation of target.getAnimations?.() ?? []) {
    if (isInfinite(animation)) track(animation.effect?.target);
  }
  target.addEventListener("animationstart", onAnimationStart, true);
  target.addEventListener("animationcancel", onAnimationCancel, true);
  target.addEventListener("visibilitychange", onVisibilityChange);
  if (idleEnabled) {
    for (const type of ACTIVITY_EVENTS) target.addEventListener(type, onActivity, { capture: true, passive: true });
    idleTimer = timers.setTimeout(checkIdle, idleAfterMs);
  }

  return () => {
    target.removeEventListener("animationstart", onAnimationStart, true);
    target.removeEventListener("animationcancel", onAnimationCancel, true);
    target.removeEventListener("visibilitychange", onVisibilityChange);
    if (idleEnabled) {
      for (const type of ACTIVITY_EVENTS) target.removeEventListener(type, onActivity, { capture: true });
      if (idleTimer !== null) timers.clearTimeout(idleTimer);
      idleTimer = null;
    }
    observer?.disconnect();
    for (const element of tracked) element.removeAttribute(IDLE_PAUSED_ATTRIBUTE);
    tracked.clear();
  };
}
