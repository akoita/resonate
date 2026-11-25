import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import TopbarSearch, { isTypingTarget, resultsSummary } from "./TopbarSearch";

describe("TopbarSearch (#2671)", () => {
  it("renders a labelled combobox with a shortcut and a hidden results list", () => {
    const html = renderToStaticMarkup(<TopbarSearch />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="Search artists, releases, tracks and playlists"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-keyshortcuts="/ Control+K Meta+K"');
    expect(html).toContain('role="listbox"');
    expect(html).toMatch(/class="topbar-search-panel" hidden=""/);
  });

  it("does not steal '/' from a field the person is typing in", () => {
    expect(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON", isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("announces what happened", () => {
    expect(resultsSummary("loading", 0, "ni")).toBe("Searching…");
    expect(resultsSummary("ready", 0, "zz")).toBe("No results for “zz”.");
    expect(resultsSummary("ready", 1, "ni")).toMatch(/^1 result\./);
    expect(resultsSummary("ready", 4, "ni")).toMatch(/^4 results\./);
    expect(resultsSummary("error", 0, "ni")).toMatch(/not available/);
  });
});
