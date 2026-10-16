/**
 * The two pages (#2166): the auth gate and the role check run before any data
 * is shown. Effects do not run in a static render, so these cover the first
 * paint; the states each response produces are covered by the view tests.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ value: { token: "token", role: "operator" as string | null, status: "authenticated" } }));
vi.mock("../../../components/auth/AuthProvider", () => ({ useAuth: () => auth.value }));
vi.mock("../../../components/auth/AuthGate", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../components/ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/users",
  useSearchParams: () => new URLSearchParams("status=suspended&q=nova"),
  useParams: () => ({ id: "user-1" }),
}));
const api = vi.hoisted(() => ({
  getAdminUsersOverview: vi.fn(() => new Promise(() => {})),
  listAdminUsers: vi.fn(() => new Promise(() => {})),
  getAdminUser: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../lib/api")>()), ...api }));

import AdminUsersPage from "./page";
import AdminUserDetailPage from "./[id]/page";

beforeEach(() => {
  auth.value = { token: "token", role: "operator", status: "authenticated" };
});

describe("/admin/users page", () => {
  it("lets an operator in and reads the filters from the URL", () => {
    const html = renderToStaticMarkup(<AdminUsersPage />);
    expect(html).toContain("<h1>Users</h1>");
    expect(html).toContain('value="nova"');
    expect(html).toMatch(/<option value="suspended" selected/);
    expect(html).toContain("Loading people");
  });

  it("lets an admin in", () => {
    auth.value = { token: "token", role: "admin", status: "authenticated" };
    expect(renderToStaticMarkup(<AdminUsersPage />)).toContain("<h1>Users</h1>");
  });

  it("shows access denied to anyone else, without asking the server for data", () => {
    api.listAdminUsers.mockClear();
    for (const role of ["agent", null, "artist"]) {
      auth.value = { token: "token", role, status: "authenticated" };
      const html = renderToStaticMarkup(<AdminUsersPage />);
      expect(html).toContain("Admins and operators only");
      expect(html).not.toContain("<table");
    }
    expect(api.listAdminUsers).not.toHaveBeenCalled();
  });
});

describe("/admin/users/[id] page", () => {
  it("lets an operator in", () => {
    const html = renderToStaticMarkup(<AdminUserDetailPage />);
    expect(html).toContain("Loading user record");
  });

  it("shows access denied to anyone else", () => {
    auth.value = { token: "token", role: "listener", status: "authenticated" };
    const html = renderToStaticMarkup(<AdminUserDetailPage />);
    expect(html).toContain("Admins and operators only");
    expect(api.getAdminUser).not.toHaveBeenCalled();
  });
});
