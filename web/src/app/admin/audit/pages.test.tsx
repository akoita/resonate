/**
 * The page (#2173): the auth gate and the admin check run before any data is
 * requested. Effects do not run in a static render, so this covers the first
 * paint and that nobody but an admin is let in.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ value: { token: "token", role: "admin" as string | null, status: "authenticated" } }));
vi.mock("../../../components/auth/AuthProvider", () => ({ useAuth: () => auth.value }));
vi.mock("../../../components/auth/AuthGate", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AdminAuditPage from "./page";

beforeEach(() => {
  auth.value = { token: "token", role: "admin", status: "authenticated" };
});

describe("/admin/audit page", () => {
  it("lets an admin in", () => {
    const html = renderToStaticMarkup(<AdminAuditPage />);
    expect(html).toContain("Admin audit log");
    expect(html).toContain("Loading the audit log");
  });

  it("shows access denied to operators and everyone else", () => {
    for (const role of ["operator", "agent", null, "artist"]) {
      auth.value = { token: "token", role, status: "authenticated" };
      const html = renderToStaticMarkup(<AdminAuditPage />);
      expect(html).toContain("Admins only");
      expect(html).not.toContain("Loading the audit log");
    }
  });
});
