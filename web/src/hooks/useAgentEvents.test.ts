import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./useAgentEvents";

// Effects never run in a server-less node test, so a tiny hook runtime keeps
// state/ref slots and re-runs an effect (after its cleanup) when its deps change.
type Effect = { fn: () => void | (() => void); deps?: unknown[] };
let slots: unknown[] = [];
let slotIndex = 0;
let pendingEffects: Effect[] = [];
let mounted: Array<{ deps?: unknown[]; cleanup?: void | (() => void) }> = [];

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      pendingEffects.push({ fn, deps });
    },
    useState: <T,>(initial: T | (() => T)) => {
      const index = slotIndex++;
      if (!(index in slots)) {
        slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((previous: T) => T)) => {
        slots[index] = typeof next === "function" ? (next as (previous: T) => T)(slots[index] as T) : next;
      };
      return [slots[index] as T, setState] as const;
    },
    useRef: <T,>(initial: T) => {
      const index = slotIndex++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
  };
});

let authToken: string | null = null;
vi.mock("../components/auth/AuthProvider", () => ({
  useAuth: () => ({ token: authToken }),
}));
vi.mock("../lib/api", () => ({ API_BASE: "http://api.test" }));

type FakeSocket = {
  handlers: Record<string, (...args: unknown[]) => void>;
  on: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};
const sockets: FakeSocket[] = [];
const ioMock = vi.fn((...args: [string, Record<string, unknown>]) => {
  void args;
  const socket: FakeSocket = {
    handlers: {},
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      socket.handlers[event] = handler;
    }),
    disconnect: vi.fn(),
  };
  sockets.push(socket);
  return socket;
});
vi.mock("socket.io-client", () => ({
  io: (url: string, options: Record<string, unknown>) => ioMock(url, options),
}));

import { useAgentEvents } from "./useAgentEvents";

const runHook = <T,>(hook: () => T): T => hook();

function renderPass(): AgentEvent[] {
  slotIndex = 0;
  pendingEffects = [];
  const events = runHook(useAgentEvents);
  pendingEffects.forEach((effect, index) => {
    const previous = mounted[index];
    const changed =
      !previous ||
      !effect.deps ||
      !previous.deps ||
      effect.deps.some((dep, depIndex) => !Object.is(dep, previous.deps?.[depIndex]));
    if (!changed) return;
    if (typeof previous?.cleanup === "function") previous.cleanup();
    mounted[index] = { deps: effect.deps, cleanup: effect.fn() };
  });
  return events;
}

function unmount() {
  mounted.forEach((entry) => {
    if (typeof entry.cleanup === "function") entry.cleanup();
  });
  mounted = [];
}

function emit(socket: FakeSocket, event: Partial<AgentEvent>) {
  socket.handlers["agent.event"]({
    id: "evt-1",
    type: "agent.decision_made",
    sessionId: "s-1",
    message: "Picked a track",
    timestamp: "2026-10-04T10:00:00.000Z",
    ...event,
  });
}

describe("useAgentEvents", () => {
  beforeEach(() => {
    slots = [];
    slotIndex = 0;
    pendingEffects = [];
    mounted = [];
    sockets.length = 0;
    authToken = null;
    ioMock.mockClear();
  });

  it("does not open a socket without a session token", () => {
    expect(renderPass()).toEqual([]);
    expect(ioMock).not.toHaveBeenCalled();
  });

  it("authenticates the socket handshake with the session token", () => {
    authToken = "jwt-a";
    renderPass();

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(ioMock).toHaveBeenCalledWith(
      "http://api.test",
      expect.objectContaining({ auth: { token: "jwt-a" } }),
    );
  });

  it("exposes received agent events with their icon, newest first", () => {
    authToken = "jwt-a";
    renderPass();

    emit(sockets[0], { id: "evt-1", type: "agent.decision_made" });
    emit(sockets[0], { id: "evt-2", type: "unknown.type" });
    const events = renderPass();

    expect(events.map((event) => [event.id, event.icon])).toEqual([
      ["evt-2", "📋"],
      ["evt-1", "✅"],
    ]);
  });

  it("reconnects with the new token and clears the previous account's events on a token change", () => {
    authToken = "jwt-a";
    renderPass();
    emit(sockets[0], { id: "evt-a" });
    expect(renderPass()).toHaveLength(1);

    authToken = "jwt-b";
    const events = renderPass();

    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
    expect(ioMock).toHaveBeenCalledTimes(2);
    expect(ioMock).toHaveBeenLastCalledWith(
      "http://api.test",
      expect.objectContaining({ auth: { token: "jwt-b" } }),
    );
    expect(events).toEqual([]);
    expect(renderPass()).toEqual([]);
  });

  it("disconnects and stops listening when the token is cleared", () => {
    authToken = "jwt-a";
    renderPass();

    authToken = null;
    renderPass();

    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it("disconnects the socket on unmount", () => {
    authToken = "jwt-a";
    renderPass();

    unmount();

    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
