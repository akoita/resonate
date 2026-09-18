/**
 * #1771 — the Settings door a person deletes their account through.
 *
 * The web unit suite runs in a `node` environment with no DOM (see
 * `vitest.config.ts`), so the two states are asserted through static rendering
 * and the request flow is asserted through the exported runners with `fetch`
 * stubbed the way `src/lib/api.test.ts` stubs it.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import {
  AccountClosureCard,
  CLOSURE_CONFIRM_MESSAGE,
  cancelScheduledAccountClosure,
  describeTimeUntilClosure,
  formatClosureDate,
  isPasskeyDismissal,
  scheduleAccountClosure,
} from "./AccountClosurePanel";
import {
  getAccountClosureState,
  resetAccountClosureState,
  subscribeToAccountClosure,
} from "./accountClosureState";
import { API_BASE } from "../../lib/api";

type Toast = { type: string; title: string; message: string };

const mockFetch = vi.fn();

const CHALLENGE = {
  address: "0xabc0000000000000000000000000000000000001",
  message:
    "Resonate: delete my account and my personal data.\nAddress: 0xabc0000000000000000000000000000000000001\nNonce: 7f3c",
  nonce: "7f3c",
};

const PENDING = {
  id: "closure-1",
  requestedAt: "2026-09-18T10:00:00.000Z",
  dueAt: "2026-10-18T10:00:00.000Z",
  status: "pending",
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

function errorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: "Error",
    text: async () => JSON.stringify(body),
  };
}

function collectToasts() {
  const toasts: Toast[] = [];
  return { toasts, addToast: (toast: Toast) => toasts.push(toast) };
}

function requestBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe("scheduling an account deletion (#1771)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetAccountClosureState();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the challenge first, then submits the signature over it", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(CHALLENGE))
      .mockResolvedValueOnce(jsonResponse(PENDING));
    const signMessage = vi.fn(async () => "0xsignature");
    const { toasts, addToast } = collectToasts();

    await scheduleAccountClosure("jwt-token", signMessage, addToast);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(`${API_BASE}/privacy/account/closure/challenge`);
    expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(mockFetch.mock.calls[1][0]).toBe(`${API_BASE}/privacy/account/closure`);
    expect((mockFetch.mock.calls[1][1] as RequestInit).method).toBe("POST");
    expect(requestBody(mockFetch.mock.calls[1])).toEqual({
      address: CHALLENGE.address,
      signature: "0xsignature",
    });
    expect(toasts[0].type).toBe("success");
    expect(toasts[0].message).toContain("Signing in before then cancels it");
  });

  it("signs the server's message verbatim and never composes its own", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(CHALLENGE))
      .mockResolvedValueOnce(jsonResponse(PENDING));
    const signMessage = vi.fn(async () => "0xsignature");
    const { addToast } = collectToasts();

    await scheduleAccountClosure("jwt-token", signMessage, addToast);

    // Exactly the server's bytes: the server verifies against its own
    // reconstruction, and a client that rewrites the text could also show one
    // sentence while authorising another.
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledWith(CHALLENGE.message);
    // And nothing about the message travels back up to the server.
    expect(requestBody(mockFetch.mock.calls[1])).not.toHaveProperty("message");
  });

  it("publishes the pending request so every surface sees it at once", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(CHALLENGE))
      .mockResolvedValueOnce(jsonResponse(PENDING));
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeToAccountClosure((state) => seen.push(state.request?.id ?? null));
    const { addToast } = collectToasts();

    await scheduleAccountClosure("jwt-token", vi.fn(async () => "0xsignature"), addToast);
    unsubscribe();

    expect(seen).toContain("closure-1");
    expect(getAccountClosureState().request?.dueAt).toBe(PENDING.dueAt);
  });

  it("treats a dismissed passkey prompt as a change of mind: no request, no error", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(CHALLENGE));
    const cancelled = Object.assign(
      new Error("The operation either timed out or was not allowed."),
      { name: "NotAllowedError" },
    );
    const { toasts, addToast } = collectToasts();

    await scheduleAccountClosure("jwt-token", vi.fn(async () => { throw cancelled; }), addToast);

    // Only the challenge was fetched — nothing was scheduled.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getAccountClosureState().request).toBeNull();
    // Nothing went wrong, so nothing is said at all.
    expect(toasts).toEqual([]);
  });

  it("says something different for the wrong account than for a refused signature", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(CHALLENGE))
      .mockResolvedValueOnce(errorResponse(403, { message: "forbidden" }));
    const forbidden = collectToasts();
    await scheduleAccountClosure("jwt-token", vi.fn(async () => "0xsignature"), forbidden.addToast);

    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(jsonResponse(CHALLENGE))
      .mockResolvedValueOnce(errorResponse(400, { message: "bad signature" }));
    const refused = collectToasts();
    await scheduleAccountClosure("jwt-token", vi.fn(async () => "0xsignature"), refused.addToast);

    expect(forbidden.toasts).toHaveLength(1);
    expect(refused.toasts).toHaveLength(1);
    expect(forbidden.toasts[0].title).not.toBe(refused.toasts[0].title);
    expect(forbidden.toasts[0].message).not.toBe(refused.toasts[0].message);
    expect(forbidden.toasts[0].message.toLowerCase()).toContain("different account");
    expect(refused.toasts[0].message.toLowerCase()).toContain("did not check out");
    // Neither outcome may leave someone believing a deletion is under way.
    for (const toast of [...forbidden.toasts, ...refused.toasts]) {
      expect(toast.message.toLowerCase()).toMatch(/nothing has (changed|been scheduled)/);
    }
    expect(getAccountClosureState().request).toBeNull();
  });

  it("reads the deadline whether the server wraps the request or returns it bare", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(CHALLENGE))
      .mockResolvedValueOnce(jsonResponse({ request: PENDING, windowDays: 30 }));
    const { toasts, addToast } = collectToasts();

    await scheduleAccountClosure("jwt-token", vi.fn(async () => "0xsignature"), addToast);

    expect(getAccountClosureState().request?.dueAt).toBe(PENDING.dueAt);
    expect(toasts[0].type).toBe("success");
    expect(toasts[0].message).toContain(formatClosureDate(PENDING.dueAt));
  });

  it("treats a 401 from the signature check the same as a 400 — a retry, not a sign-out", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(CHALLENGE))
      .mockResolvedValueOnce(errorResponse(401, { message: "that signature does not match" }));
    const { toasts, addToast } = collectToasts();

    await scheduleAccountClosure("jwt-token", vi.fn(async () => "0xsignature"), addToast);

    // The request reached the signature check, so the session that carried it
    // is still good; the thing that failed is the signature.
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message.toLowerCase()).toContain("did not check out");
    expect(getAccountClosureState().request).toBeNull();
  });

  it("refuses to announce a deletion the server did not date", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(CHALLENGE))
      .mockResolvedValueOnce(jsonResponse({ windowDays: 30 }));
    const { toasts, addToast } = collectToasts();

    await scheduleAccountClosure("jwt-token", vi.fn(async () => "0xsignature"), addToast);

    // Better to say it did not work than to claim a deadline we cannot show.
    expect(toasts[0].type).toBe("error");
    expect(getAccountClosureState().request).toBeNull();
  });

  it("reports a server failure without scheduling anything, and does not throw at the caller", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(CHALLENGE))
      .mockResolvedValueOnce(errorResponse(500, { message: "boom" }));
    const { toasts, addToast } = collectToasts();

    await expect(
      scheduleAccountClosure("jwt-token", vi.fn(async () => "0xsignature"), addToast),
    ).resolves.toBeUndefined();

    expect(toasts[0].type).toBe("error");
    expect(getAccountClosureState().request).toBeNull();
  });

  it("does not reach the passkey when the challenge itself fails", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, { message: "boom" }));
    const signMessage = vi.fn(async () => "0xsignature");
    const { toasts, addToast } = collectToasts();

    await scheduleAccountClosure("jwt-token", signMessage, addToast);

    expect(signMessage).not.toHaveBeenCalled();
    expect(toasts[0].type).toBe("error");
  });
});

describe("cancelling a scheduled deletion (#1771)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetAccountClosureState();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes the request with no signature and clears the pending state everywhere", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, statusText: "No Content" });
    const { toasts, addToast } = collectToasts();

    await cancelScheduledAccountClosure("jwt-token", addToast);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(`${API_BASE}/privacy/account/closure`);
    expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    // Cancelling is the safe direction, so it costs nothing extra.
    expect((mockFetch.mock.calls[0][1] as RequestInit).body).toBeUndefined();
    expect(getAccountClosureState()).toEqual({ known: true, request: null });
    expect(toasts[0].type).toBe("success");
  });

  it("tells someone whose cancel failed that signing in still stops it", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, { message: "boom" }));
    const { toasts, addToast } = collectToasts();

    await cancelScheduledAccountClosure("jwt-token", addToast);

    expect(toasts[0].type).toBe("error");
    expect(toasts[0].message.toLowerCase()).toContain("signing in also cancels it");
  });
});

describe("account deletion panel (#1771)", () => {
  it("states the 30 days, the way back, and what stays — before anything is clicked", () => {
    const html = renderToStaticMarkup(
      <AccountClosureCard
        request={null}
        signedIn
        busy={null}
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
      />,
    );

    expect(html).toContain("Delete my account");
    expect(html).toContain("30 days");
    expect(html).toContain("Signing in at any point before then cancels it");
    expect(html).toContain("permanent and cannot be undone");
    expect(html).toContain("IPFS");
    expect(html).toContain("blockchain");
    expect(html).toContain("legally obliged to keep");
    expect(html).toContain("stops streaming on Resonate");
  });

  it("never suggests a purchase can be taken away", () => {
    const html = renderToStaticMarkup(
      <AccountClosureCard
        request={null}
        signedIn
        busy={null}
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
      />,
    );

    expect(html).toContain("keep it");
    expect(html).toContain("does not take it away from them");
    expect(html.toLowerCase()).not.toContain("lose what they bought");
    expect(html.toLowerCase()).not.toContain("refund");
  });

  it("offers a single action, disabled while the passkey is being awaited", () => {
    const idle = renderToStaticMarkup(
      <AccountClosureCard
        request={null}
        signedIn
        busy={null}
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
      />,
    );
    expect(idle.match(/<button/g) ?? []).toHaveLength(1);
    expect(idle).not.toContain("disabled");

    const working = renderToStaticMarkup(
      <AccountClosureCard
        request={null}
        signedIn
        busy="scheduling"
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
      />,
    );
    expect(working).toContain("Waiting for your passkey...");
    expect(working).toContain("disabled");
  });

  it("shows the date, the days left, and a cancel with no friction once one is pending", () => {
    const html = renderToStaticMarkup(
      <AccountClosureCard
        request={PENDING}
        signedIn
        busy={null}
        onRequestDelete={() => {}}
        onCancelDelete={() => {}}
        now={new Date("2026-10-12T10:00:00.000Z")}
      />,
    );

    expect(html).toContain("scheduled for deletion");
    expect(html).toContain(formatClosureDate(PENDING.dueAt));
    expect(html).toContain("in 6 days");
    expect(html).toContain("Cancel deletion");
    expect(html).toContain("Signing in also cancels it");
    // The pending state is a way out, not a second chance to delete.
    expect(html).not.toContain("Delete my account");
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
  });
});

describe("account deletion copy and helpers (#1771)", () => {
  it("makes every promise the confirmation has to make", () => {
    const message = CLOSURE_CONFIRM_MESSAGE;
    expect(message).toContain("cannot be undone");
    expect(message).toContain("30 days");
    expect(message).toContain("Signing in at any point before then cancels the deletion");
    expect(message).toContain("law obliges us to keep");
    expect(message).toContain("blockchain");
    expect(message).toContain("IPFS");
    expect(message).toContain("stops streaming on Resonate");
    expect(message).toContain("People who bought something from you keep it");
  });

  it("uses the same honest-limits words as the export panel, so the two cannot disagree", () => {
    // Both say the same thing about the two places data lives outside our
    // systems; if one is ever softened, this pins the other to it.
    expect(CLOSURE_CONFIRM_MESSAGE).toContain("live outside Resonate, are public by design, and stay where they are");
  });

  it("counts the remaining days the way a person would say them", () => {
    const due = "2026-10-18T10:00:00.000Z";
    expect(describeTimeUntilClosure(due, new Date("2026-09-18T10:00:00.000Z"))).toBe("in 30 days");
    // Rounded up: something happening in twenty hours is "tomorrow", not "today".
    expect(describeTimeUntilClosure(due, new Date("2026-10-17T14:00:00.000Z"))).toBe("tomorrow");
    // But an hour away is today — "tomorrow" would promise time that is gone.
    expect(describeTimeUntilClosure(due, new Date("2026-10-18T09:00:00.000Z"))).toBe("today");
    // Never a negative countdown if the job is running late.
    expect(describeTimeUntilClosure(due, new Date("2026-10-19T10:00:00.000Z"))).toBe("today");
  });

  it("never renders an unreadable date, whatever the server sent", () => {
    expect(formatClosureDate("2026-10-18T10:00:00.000Z")).toContain("2026");
    expect(formatClosureDate("not-a-date")).toBe("the scheduled date");
    expect(describeTimeUntilClosure("not-a-date")).toBe("soon");
  });

  it("recognises a dismissed passkey prompt, and only that", () => {
    expect(isPasskeyDismissal(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe(true);
    expect(isPasskeyDismissal(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
    expect(
      isPasskeyDismissal(new Error("The operation either timed out or was not allowed.")),
    ).toBe(true);
    expect(isPasskeyDismissal(new Error("Network request failed"))).toBe(false);
  });
});
