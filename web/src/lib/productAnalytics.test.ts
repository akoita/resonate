import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compactProductAnalyticsPayload,
  createProductAnalyticsClientEventId,
  getProductAnalyticsSessionId,
  PRODUCT_ANALYTICS_EVENT_NAMES,
  recordProductAnalytics,
  recordProductAnalyticsFromBrowser,
} from "./productAnalytics";
import { TOKEN_KEY } from "./authSession";

vi.mock("./api", () => ({
  recordProductAnalyticsEvent: vi.fn(() => Promise.resolve({ status: "ok", eventId: "event-1", ingested: 1 })),
}));

import { recordProductAnalyticsEvent } from "./api";

describe("product analytics helpers", () => {
  beforeEach(() => {
    const sessionStore = new Map<string, string>();
    const localStore = new Map<string, string>();
    const sessionStorageMock = {
      getItem: vi.fn((key: string) => sessionStore.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        sessionStore.set(key, value);
      }),
    };
    const localStorageMock = {
      getItem: vi.fn((key: string) => localStore.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStore.set(key, value);
      }),
    };
    const cryptoMock = { randomUUID: vi.fn(() => "uuid-1") };

    vi.stubGlobal("sessionStorage", sessionStorageMock);
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("crypto", cryptoMock);
    vi.stubGlobal("window", {
      sessionStorage: sessionStorageMock,
      localStorage: localStorageMock,
      crypto: cryptoMock,
    });
    localStorage.setItem(TOKEN_KEY, "token-1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates one product session id per browser tab", () => {
    expect(getProductAnalyticsSessionId()).toBe("uuid-1");
    expect(getProductAnalyticsSessionId()).toBe("uuid-1");
    expect(sessionStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it("builds best-effort events with source, session, and client ids", async () => {
    await recordProductAnalytics("token-1", "playlist.created", {
      subjectType: "playlist",
      subjectId: "playlist-1",
      payload: {
        trackCount: 0,
        name: undefined,
      },
    });

    expect(recordProductAnalyticsEvent).toHaveBeenCalledWith("token-1", {
      eventName: "playlist.created",
      source: "web",
      sessionId: "uuid-1",
      clientEventId: "uuid-1",
      subjectType: "playlist",
      subjectId: "playlist-1",
      payload: {
        trackCount: 0,
      },
    });
  });

  it("can read the browser auth token for low-level UI stores", () => {
    recordProductAnalyticsFromBrowser("settings.updated", {
      payload: { surface: "library", setting: "autoScanOnLoad", enabled: true },
    });

    expect(recordProductAnalyticsEvent).toHaveBeenCalledWith(
      "token-1",
      expect.objectContaining({
        eventName: "settings.updated",
        payload: {
          surface: "library",
          setting: "autoScanOnLoad",
          enabled: true,
        },
      }),
    );
  });

  it("drops undefined payload values before sending", () => {
    expect(
      compactProductAnalyticsPayload({
        step: "metadata",
        freeText: undefined,
        count: 2,
      }),
    ).toEqual({
      step: "metadata",
      count: 2,
    });
  });

  it("allows Session Intent analytics events", () => {
    expect(PRODUCT_ANALYTICS_EVENT_NAMES).toEqual(
      expect.arrayContaining([
        "agent.intent_viewed",
        "agent.intent_selected",
        "agent.session_started",
        "agent.session_stopped",
        "agent.next_pick_requested",
        "player.action_impression",
        "player.action_selected",
      ]),
    );
  });

  it("falls back to generated ids outside browser crypto", () => {
    vi.unstubAllGlobals();
    vi.spyOn(Date, "now").mockReturnValue(123);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(createProductAnalyticsClientEventId()).toBe("product_event_123_8");
  });
});
