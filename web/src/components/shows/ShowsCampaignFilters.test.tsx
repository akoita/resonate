import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  current: { role: "operator" as string | null },
}));

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => auth.current }));

import { ShowsCampaignFilters } from "./ShowsCampaignFilters";

afterEach(() => {
  auth.current = { role: "operator" };
});

describe("ShowsCampaignFilters", () => {
  it("renders status filters for operators", () => {
    const html = renderToStaticMarkup(<ShowsCampaignFilters activeFilter="all" />);

    expect(html).toContain("Campaign status filter");
    expect(html).toContain("href=\"/shows?scope=all\"");
    expect(html).toContain("href=\"/shows?status=cancelled\"");
    expect(html).toContain("aria-current=\"page\"");
  });

  it("renders status filters for admins", () => {
    auth.current = { role: "admin" };

    const html = renderToStaticMarkup(<ShowsCampaignFilters activeFilter="released" />);

    expect(html).toContain("Released");
    expect(html).toContain("href=\"/shows?status=released\"");
  });

  it("hides status filters for non-operator viewers", () => {
    auth.current = { role: "listener" };

    expect(renderToStaticMarkup(<ShowsCampaignFilters activeFilter="default" />)).toBe("");
  });
});
