import { describe, expect, it, vi } from "vitest";
import {
  buildReport,
  installBrowserErrorReporting,
  MAX_REPORTS_PER_PAGE,
  parseBrowserErrorReport,
  withoutQuery,
} from "./browserErrors";

function fakeWindow(pathname = "/player") {
  const target = new EventTarget();
  return {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    location: { pathname } as Location,
    navigator: { sendBeacon: vi.fn(() => true) },
  };
}

function errorEvent(error: Error, filename = "https://app.test/_next/x.js?v=1") {
  // Node has no ErrorEvent; an Event with the same fields is what the listener reads.
  return Object.assign(new Event("error"), { error, message: error.message, filename, lineno: 3, colno: 9 });
}

describe("browser error reports", () => {
  it("drops query strings from paths, sources and stack frames", () => {
    expect(withoutQuery("/player?token=abc#x")).toBe("/player");
    const error = new Error("boom");
    error.stack = "Error: boom\n    at run (https://app.test/_next/a.js?sig=secret:1:2)";
    const report = buildReport("error", error, { pathname: "/p" }, { source: "https://app.test/a.js?x=1" });
    expect(report.stack).not.toContain("secret");
    expect(report.source).toBe("https://app.test/a.js");
  });

  it("describes non-Error rejections", () => {
    expect(buildReport("unhandledrejection", { code: 7 }, { pathname: "/" })).toMatchObject({
      name: "NonError",
      message: '{"code":7}',
    });
  });

  it("sends each distinct error once and caps reports per page", () => {
    const win = fakeWindow();
    const send = vi.fn();
    installBrowserErrorReporting(win as never, send);

    win.dispatchEvent(errorEvent(new Error("same")));
    win.dispatchEvent(errorEvent(new Error("same")));
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({ kind: "error", message: "same", path: "/player", line: 3 });

    for (let i = 0; i < 20; i += 1) win.dispatchEvent(errorEvent(new Error(`e${i}`)));
    expect(send).toHaveBeenCalledTimes(MAX_REPORTS_PER_PAGE);
  });

  it("reports unhandled promise rejections", () => {
    const win = fakeWindow();
    const send = vi.fn();
    installBrowserErrorReporting(win as never, send);
    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    event.reason = new TypeError("bad fetch");
    win.dispatchEvent(event);
    expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({ kind: "unhandledrejection", name: "TypeError" });
  });

  it("never throws when sending fails", () => {
    const win = fakeWindow();
    installBrowserErrorReporting(win as never, () => {
      throw new Error("offline");
    });
    expect(() => win.dispatchEvent(errorEvent(new Error("x")))).not.toThrow();
  });

  it("validates and bounds what the server accepts", () => {
    expect(parseBrowserErrorReport(null)).toBeNull();
    expect(parseBrowserErrorReport({ kind: "other", message: "x" })).toBeNull();
    const parsed = parseBrowserErrorReport({
      kind: "error",
      message: "m".repeat(5000),
      path: "/a?b=c",
      line: -1,
      extra: "ignored",
    });
    expect(parsed?.message).toHaveLength(300);
    expect(parsed?.path).toBe("/a");
    expect(parsed?.line).toBeUndefined();
    expect(parsed).not.toHaveProperty("extra");
  });
});
