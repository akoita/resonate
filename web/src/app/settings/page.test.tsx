/**
 * #2169: the Settings navigation lists "Email notices". Effects do not run in
 * a static render, so this covers the first paint and the nav only; the
 * section itself is covered by `EmailNoticesPanel.test.tsx`.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({ token: "token", disconnect: vi.fn(), status: "authenticated" }),
}));
vi.mock("../../components/auth/AuthGate", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../components/ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock("../../components/notifications/NotificationPreferences", () => ({ default: () => null }));

import SettingsPage from "./page";

describe("/settings navigation", () => {
  it("lists Email notices with its promise, next to Notifications", () => {
    const html = renderToStaticMarkup(<SettingsPage />);
    expect(html).toContain("<strong>Email notices</strong>");
    expect(html).toContain("Never marketing");
    expect(html.indexOf("<strong>Notifications</strong>")).toBeLessThan(html.indexOf("<strong>Email notices</strong>"));
  });
});
