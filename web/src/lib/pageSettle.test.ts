import { describe, expect, it } from "vitest";
import { SETTLE_MAX_MS, SETTLE_QUIET_MS, watchPageSettle } from "./pageSettle";

function setup(readyState = "loading") {
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

  const docListeners = new Map<string, Set<() => void>>();
  const winListeners = new Map<string, Set<() => void>>();
  const add = (map: Map<string, Set<() => void>>) => (type: string, listener: () => void) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type)!.add(listener);
  };
  const remove = (map: Map<string, Set<() => void>>) => (type: string, listener: () => void) => {
    map.get(type)?.delete(listener);
  };
  const win = {
    document: {
      readyState,
      body: {},
      addEventListener: add(docListeners),
      removeEventListener: remove(docListeners),
    },
    addEventListener: add(winListeners),
    removeEventListener: remove(winListeners),
  };

  let mutate: (records: { addedNodes?: { nodeType?: number }[] }[]) => void = () => {};
  let disconnected = false;
  class FakeMutationObserver {
    constructor(callback: typeof mutate) {
      mutate = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  }

  let settledAt: number | null = null;
  const start = () =>
    watchPageSettle(
      () => {
        settledAt = clock;
      },
      { win, MutationObserverCtor: FakeMutationObserver as never, timers },
    );

  return {
    start,
    advance,
    settledAt: () => settledAt,
    finishLoading: () => {
      win.document.readyState = "complete";
      for (const listener of winListeners.get("load") ?? []) listener();
    },
    addElement: () => mutate([{ addedNodes: [{ nodeType: 1 }] }]),
    changeText: () => mutate([{ addedNodes: [{ nodeType: 3 }] }]),
    resourceLoaded: () => {
      for (const listener of docListeners.get("load") ?? []) listener();
    },
    listenerCount: () =>
      [...docListeners.values(), ...winListeners.values()].reduce((sum, set) => sum + set.size, 0),
    pendingTimers: () => pending.size,
    isDisconnected: () => disconnected,
  };
}

describe("watchPageSettle", () => {
  it("settles once the document has loaded and stayed quiet", () => {
    const env = setup("complete");
    env.start();
    env.advance(SETTLE_QUIET_MS - 1);
    expect(env.settledAt()).toBeNull();
    env.advance(1);
    expect(env.settledAt()).toBe(SETTLE_QUIET_MS);
  });

  it("waits for the load event before counting quiet time", () => {
    const env = setup("loading");
    env.start();
    env.advance(3000);
    expect(env.settledAt()).toBeNull();
    env.finishLoading();
    env.advance(SETTLE_QUIET_MS);
    expect(env.settledAt()).toBe(3000 + SETTLE_QUIET_MS);
  });

  it("restarts the quiet window when elements are added or a resource finishes loading", () => {
    const env = setup("complete");
    env.start();
    env.advance(1000);
    env.addElement();
    env.advance(1000);
    env.resourceLoaded();
    env.advance(SETTLE_QUIET_MS - 1);
    expect(env.settledAt()).toBeNull();
    env.advance(1);
    expect(env.settledAt()).toBe(2000 + SETTLE_QUIET_MS);
  });

  it("ignores text changes, so a ticking clock cannot hold the page unsettled", () => {
    const env = setup("complete");
    env.start();
    env.advance(1000);
    env.changeText();
    env.advance(SETTLE_QUIET_MS - 1000);
    expect(env.settledAt()).toBe(SETTLE_QUIET_MS);
  });

  it("settles at the cap even if the page never goes quiet or never finishes loading", () => {
    const busy = setup("complete");
    busy.start();
    for (let elapsed = 0; elapsed < SETTLE_MAX_MS; elapsed += 500) {
      busy.addElement();
      busy.advance(500);
    }
    expect(busy.settledAt()).toBe(SETTLE_MAX_MS);

    const stuck = setup("loading");
    stuck.start();
    stuck.advance(SETTLE_MAX_MS);
    expect(stuck.settledAt()).toBe(SETTLE_MAX_MS);
  });

  it("fires once and releases its listeners, observer and timer", () => {
    const env = setup("complete");
    env.start();
    env.advance(SETTLE_QUIET_MS);
    expect(env.listenerCount()).toBe(0);
    expect(env.pendingTimers()).toBe(0);
    expect(env.isDisconnected()).toBe(true);
    env.addElement();
    env.advance(SETTLE_MAX_MS);
    expect(env.settledAt()).toBe(SETTLE_QUIET_MS);
  });

  it("can be cancelled before it settles", () => {
    const env = setup("complete");
    const cancel = env.start();
    cancel();
    env.advance(SETTLE_MAX_MS);
    expect(env.settledAt()).toBeNull();
    expect(env.listenerCount()).toBe(0);
    expect(env.pendingTimers()).toBe(0);
  });
});
