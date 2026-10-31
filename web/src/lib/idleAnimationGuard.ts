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

type AnimationLike = {
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

export type IdleAnimationGuardOptions = {
  doc?: GuardDocument;
  IntersectionObserverCtor?: ObserverCtor;
};

function isInfinite(animation: AnimationLike): boolean {
  return animation.effect?.getTiming?.().iterations === Infinity;
}

function hasInfiniteAnimation(element: Element): boolean {
  const getAnimations = (element as Element & { getAnimations?: (o?: { subtree?: boolean }) => AnimationLike[] })
    .getAnimations;
  if (typeof getAnimations !== "function") return false;
  // `subtree` includes the element's own ::before/::after; keep only those
  // whose target is this element (descendants are tracked on their own).
  return getAnimations
    .call(element, { subtree: true })
    .some((animation) => animation.effect?.target === element && isInfinite(animation));
}

/** Start the guard. Returns a cleanup that removes every listener and mark. */
export function startIdleAnimationGuard({ doc, IntersectionObserverCtor }: IdleAnimationGuardOptions = {}): () => void {
  const target: GuardDocument | undefined =
    doc ?? (typeof document === "undefined" ? undefined : (document as unknown as GuardDocument));
  const Observer =
    IntersectionObserverCtor ??
    (typeof IntersectionObserver === "undefined" ? undefined : (IntersectionObserver as unknown as ObserverCtor));
  if (!target) return () => {};

  const tracked = new Set<Element>();
  const offscreen = new WeakSet<Element>();
  let tabHidden = target.visibilityState === "hidden";

  const apply = (element: Element) => {
    if (tabHidden || offscreen.has(element)) element.setAttribute(IDLE_PAUSED_ATTRIBUTE, "");
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

  const onVisibilityChange = () => {
    tabHidden = target.visibilityState === "hidden";
    for (const element of tracked) {
      if (!element.isConnected) forget(element);
      else apply(element);
    }
  };

  for (const animation of target.getAnimations?.() ?? []) {
    if (isInfinite(animation)) track(animation.effect?.target);
  }
  target.addEventListener("animationstart", onAnimationStart, true);
  target.addEventListener("animationcancel", onAnimationCancel, true);
  target.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    target.removeEventListener("animationstart", onAnimationStart, true);
    target.removeEventListener("animationcancel", onAnimationCancel, true);
    target.removeEventListener("visibilitychange", onVisibilityChange);
    observer?.disconnect();
    for (const element of tracked) element.removeAttribute(IDLE_PAUSED_ATTRIBUTE);
    tracked.clear();
  };
}
