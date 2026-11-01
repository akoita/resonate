import { describe, expect, it } from "vitest";
import { IDLE_PAUSED_ATTRIBUTE, startIdleAnimationGuard } from "./idleAnimationGuard";

type FakeAnimation = {
  animationName?: string;
  effect: { target: FakeElement; getTiming: () => { iterations: number } };
};

class FakeElement {
  attrs = new Set<string>();
  isConnected = true;
  animations: FakeAnimation[] = [];
  setAttribute(name: string) {
    this.attrs.add(name);
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  getAnimations() {
    return this.animations;
  }
  get paused() {
    return this.attrs.has(IDLE_PAUSED_ATTRIBUTE);
  }
  loop(iterations = Infinity, animationName = "ping") {
    this.animations.push({ animationName, effect: { target: this, getTiming: () => ({ iterations }) } });
    return this;
  }
}

function setup(initiallyHidden = false) {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const doc = {
    visibilityState: (initiallyHidden ? "hidden" : "visible") as DocumentVisibilityState,
    animations: [] as FakeAnimation[],
    addEventListener(type: string, listener: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    getAnimations() {
      return this.animations;
    },
    fire(type: string, target?: FakeElement) {
      for (const listener of listeners.get(type) ?? []) listener({ target } as unknown as Event);
    },
    listenerCount() {
      return [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
    },
  };

  const observed = new Set<FakeElement>();
  let callback: (entries: { target: FakeElement; isIntersecting: boolean }[]) => void = () => {};
  let disconnected = false;
  class FakeObserver {
    constructor(cb: typeof callback) {
      callback = cb;
    }
    observe(element: FakeElement) {
      observed.add(element);
    }
    unobserve(element: FakeElement) {
      observed.delete(element);
    }
    disconnect() {
      disconnected = true;
      observed.clear();
    }
  }

  let clock = 0;
  const pending = new Map<number, { at: number; handler: () => void }>();
  let nextId = 1;
  const timers = {
    setTimeout: (handler: () => void, ms: number) => {
      const id = nextId++;
      pending.set(id, { at: clock + ms, handler });
      return id;
    },
    clearTimeout: (id: unknown) => {
      pending.delete(id as number);
    },
    now: () => clock,
  };
  const advance = (ms: number) => {
    const until = clock + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      clock = due[1].at;
      due[1].handler();
    }
    clock = until;
  };

  const start = (idleAfterMs = IDLE_MS) =>
    startIdleAnimationGuard({
      doc: doc as never,
      IntersectionObserverCtor: FakeObserver as never,
      idleAfterMs,
      timers,
    });
  const intersect = (target: FakeElement, isIntersecting: boolean) => callback([{ target, isIntersecting }]);
  const setHidden = (hidden: boolean) => {
    doc.visibilityState = hidden ? "hidden" : "visible";
    doc.fire("visibilitychange");
  };

  return {
    doc,
    observed,
    start,
    intersect,
    setHidden,
    advance,
    pendingTimers: () => pending.size,
    isDisconnected: () => disconnected,
  };
}

const IDLE_MS = 20_000;

describe("startIdleAnimationGuard (#2436)", () => {
  it("pauses an infinite loop while it is off-screen and resumes it on screen", () => {
    const env = setup();
    const ping = new FakeElement().loop();
    env.start();

    env.doc.fire("animationstart", ping);
    expect(env.observed.has(ping)).toBe(true);
    expect(ping.paused).toBe(false);

    env.intersect(ping, false);
    expect(ping.paused).toBe(true);

    env.intersect(ping, true);
    expect(ping.paused).toBe(false);
  });

  it("pauses every tracked loop while the tab is hidden, without losing off-screen state", () => {
    const env = setup();
    const visible = new FakeElement().loop();
    const below = new FakeElement().loop();
    env.start();
    env.doc.fire("animationstart", visible);
    env.doc.fire("animationstart", below);
    env.intersect(below, false);

    env.setHidden(true);
    expect(visible.paused).toBe(true);
    expect(below.paused).toBe(true);

    env.setHidden(false);
    expect(visible.paused).toBe(false);
    expect(below.paused).toBe(true);
  });

  it("leaves one-shot animations alone", () => {
    const env = setup();
    const entrance = new FakeElement().loop(1);
    env.start();
    env.doc.fire("animationstart", entrance);
    env.setHidden(true);

    expect(env.observed.has(entrance)).toBe(false);
    expect(entrance.paused).toBe(false);
  });

  it("picks up loops that were already running when it started, paused if the tab starts hidden", () => {
    const env = setup(true);
    const marquee = new FakeElement().loop();
    env.doc.animations.push(...marquee.animations);
    env.start();

    expect(env.observed.has(marquee)).toBe(true);
    expect(marquee.paused).toBe(true);
  });

  it("forgets an element once it leaves the document or its loop is removed", () => {
    const env = setup();
    const removed = new FakeElement().loop();
    const restyled = new FakeElement().loop();
    env.start();
    env.doc.fire("animationstart", removed);
    env.doc.fire("animationstart", restyled);

    removed.isConnected = false;
    env.intersect(removed, false);
    expect(env.observed.has(removed)).toBe(false);
    expect(removed.paused).toBe(false);

    env.intersect(restyled, false);
    restyled.animations = [];
    env.doc.fire("animationcancel", restyled);
    expect(env.observed.has(restyled)).toBe(false);
    expect(restyled.paused).toBe(false);
  });

  it("cleans up its listeners, observer, and marks", () => {
    const env = setup();
    const ping = new FakeElement().loop();
    const stop = env.start();
    env.doc.fire("animationstart", ping);
    env.setHidden(true);
    expect(ping.paused).toBe(true);

    stop();
    expect(ping.paused).toBe(false);
    expect(env.isDisconnected()).toBe(true);
    expect(env.doc.listenerCount()).toBe(0);
  });

  it("holds on-screen loops once nobody has touched the page, and resumes on input", () => {
    const env = setup();
    const ping = new FakeElement().loop();
    env.start();
    env.doc.fire("animationstart", ping);

    env.advance(IDLE_MS - 1);
    expect(ping.paused).toBe(false);
    env.advance(1);
    expect(ping.paused).toBe(true);

    env.doc.fire("pointermove");
    expect(ping.paused).toBe(false);
    env.advance(IDLE_MS);
    expect(ping.paused).toBe(true);
  });

  it("restarts the idle countdown on every input", () => {
    const env = setup();
    const ping = new FakeElement().loop();
    env.start();
    env.doc.fire("animationstart", ping);

    env.advance(IDLE_MS - 1000);
    env.doc.fire("keydown");
    env.advance(IDLE_MS - 1000);
    expect(ping.paused).toBe(false);
    env.doc.fire("scroll");
    env.advance(IDLE_MS - 1);
    expect(ping.paused).toBe(false);
    env.advance(1);
    expect(ping.paused).toBe(true);
  });

  it("holds a loop that starts while the user is idle", () => {
    const env = setup();
    env.start();
    env.advance(IDLE_MS);
    const late = new FakeElement().loop();
    env.doc.fire("animationstart", late);
    expect(late.paused).toBe(true);
  });

  it("keeps loading indicators running while the user is idle, but not off-screen", () => {
    const env = setup();
    const spinner = new FakeElement().loop(Infinity, "aid-spin");
    const skeleton = new FakeElement().loop(Infinity, "ng-shimmer");
    const mixed = new FakeElement().loop(Infinity, "spin").loop(Infinity, "glow");
    env.start();
    for (const element of [spinner, skeleton, mixed]) env.doc.fire("animationstart", element);

    env.advance(IDLE_MS);
    expect(spinner.paused).toBe(false);
    expect(skeleton.paused).toBe(false);
    expect(mixed.paused).toBe(true);

    env.intersect(spinner, false);
    expect(spinner.paused).toBe(true);
  });

  it("does not hold anything for idleness when idleAfterMs is 0", () => {
    const env = setup();
    const ping = new FakeElement().loop();
    env.start(0);
    env.doc.fire("animationstart", ping);
    env.advance(IDLE_MS * 10);
    expect(ping.paused).toBe(false);
    expect(env.pendingTimers()).toBe(0);
  });

  it("clears its idle timer on cleanup", () => {
    const env = setup();
    const stop = env.start();
    expect(env.pendingTimers()).toBe(1);
    stop();
    expect(env.pendingTimers()).toBe(0);
  });

  it("is a no-op without a document", () => {
    expect(() => startIdleAnimationGuard({ doc: undefined })()).not.toThrow();
  });
});
