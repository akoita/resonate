import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformNotice } from "./api";
import {
  EMAIL_PROMPT_CONTEXTS,
  EMAIL_PROMPT_COPY,
  STALE_NOTICE_DAYS,
  dismissEmailPrompt,
  emailPromptStorageKey,
  isEmailPromptDismissed,
  selectStaleUnreadNotices,
  shouldShowEmailPrompt,
} from "./emailPrompt";

function stubStorage(overrides: Partial<Storage> = {}) {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    ...overrides,
  } as unknown as Storage);
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe("shouldShowEmailPrompt", () => {
  it("shows only when email is available, no address is on file, and it was not dismissed", () => {
    expect(shouldShowEmailPrompt({ contact: { available: true, status: "none" }, dismissed: false })).toBe(true);
  });

  it("hides once dismissed", () => {
    expect(shouldShowEmailPrompt({ contact: { available: true, status: "none" }, dismissed: true })).toBe(false);
  });

  it("hides while the address is still loading or could not be looked up", () => {
    expect(shouldShowEmailPrompt({ contact: null, dismissed: false })).toBe(false);
  });

  it("hides when email is not configured on this deployment", () => {
    expect(shouldShowEmailPrompt({ contact: { available: false, status: "none" }, dismissed: false })).toBe(false);
  });

  it.each(["pending", "confirmed", "disabled"] as const)("hides when an address is %s", (status) => {
    expect(shouldShowEmailPrompt({ contact: { available: true, status }, dismissed: false })).toBe(false);
  });
});

describe("dismissal storage", () => {
  it("skipping a prompt keeps it gone in this browser, for that account and moment only", () => {
    const values = stubStorage();
    expect(isEmailPromptDismissed("user-1", "onboarding")).toBe(false);
    dismissEmailPrompt("user-1", "onboarding");
    expect(values.has(emailPromptStorageKey("user-1", "onboarding"))).toBe(true);
    expect(isEmailPromptDismissed("user-1", "onboarding")).toBe(true);
    // Another moment, and another account on the same browser, are unaffected.
    expect(isEmailPromptDismissed("user-1", "pledge")).toBe(false);
    expect(isEmailPromptDismissed("user-2", "onboarding")).toBe(false);
  });

  it("a skipped onboarding step is not shown again", () => {
    stubStorage();
    const contact = { available: true, status: "none" } as const;
    expect(shouldShowEmailPrompt({ contact, dismissed: isEmailPromptDismissed("u", "onboarding") })).toBe(true);
    dismissEmailPrompt("u", "onboarding");
    expect(shouldShowEmailPrompt({ contact, dismissed: isEmailPromptDismissed("u", "onboarding") })).toBe(false);
  });

  it("treats unreadable storage as dismissed, so a prompt that cannot be remembered never nags", () => {
    stubStorage({
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(isEmailPromptDismissed("user-1", "pledge")).toBe(true);
  });

  it("ignores a storage failure when dismissing", () => {
    stubStorage({
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => dismissEmailPrompt("user-1", "pledge")).not.toThrow();
  });
});

describe("selectStaleUnreadNotices", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  function notice(overrides: Partial<PlatformNotice>): PlatformNotice {
    return {
      id: "n",
      kind: "targeted",
      category: "account",
      title: "t",
      body: "b",
      link: null,
      effectiveAt: null,
      createdAt: daysAgo(STALE_NOTICE_DAYS + 1),
      readAt: null,
      ...overrides,
    };
  }

  it("selects unread account and refund notices that have waited long enough", () => {
    const selected = selectStaleUnreadNotices(
      [
        notice({ id: "a", category: "account" }),
        notice({ id: "r", category: "refund" }),
        notice({ id: "exactly", category: "refund", createdAt: daysAgo(STALE_NOTICE_DAYS) }),
      ],
      now,
    );
    expect(selected.map((n) => n.id)).toEqual(["a", "r", "exactly"]);
  });

  it("skips recent, read, and other-category notices", () => {
    const selected = selectStaleUnreadNotices(
      [
        notice({ id: "recent", createdAt: daysAgo(1) }),
        notice({ id: "read", readAt: daysAgo(1) }),
        notice({ id: "policy", category: "policy" }),
        notice({ id: "terms", category: "terms" }),
        notice({ id: "bad-date", createdAt: "not a date" }),
      ],
      now,
    );
    expect(selected).toEqual([]);
  });
});

describe("copy", () => {
  it("has words for every moment, and never promises marketing or a required email", () => {
    for (const context of EMAIL_PROMPT_CONTEXTS) {
      const { heading, body } = EMAIL_PROMPT_COPY[context];
      expect(heading.length).toBeGreaterThan(0);
      expect(body).toMatch(/optional|Optional/);
    }
    expect(EMAIL_PROMPT_COPY.pledge.heading).toBe("Get an email if a refund is ever owed to you");
    expect(EMAIL_PROMPT_COPY.onboarding.heading).toBe("Want important notices by email too?");
  });
});
