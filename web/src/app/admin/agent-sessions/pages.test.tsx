/**
 * The two pages (#2259): the auth gate and the admin check run before any data
 * is requested. Effects do not run in a static render, so these cover the first
 * paint and, above all, that nobody but an admin triggers the request.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ value: { token: "token", role: "admin" as string | null, status: "authenticated" } }));
const nav = vi.hoisted(() => ({ sessionId: "session-1" }));
vi.mock("../../../components/auth/AuthProvider", () => ({ useAuth: () => auth.value }));
vi.mock("../../../components/auth/AuthGate", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../components/ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/agent-sessions",
  useParams: () => ({ sessionId: nav.sessionId }),
}));
const api = vi.hoisted(() => ({ getAdminAgentSessionEvents: vi.fn(() => new Promise(() => {})) }));
vi.mock("../../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../lib/api")>()), ...api }));

import AdminAgentSessionsPage from "./page";
import AdminAgentSessionEventsPage from "./[sessionId]/page";

beforeEach(() => {
  auth.value = { token: "token", role: "admin", status: "authenticated" };
  nav.sessionId = "session-1";
  api.getAdminAgentSessionEvents.mockClear();
});

describe("/admin/agent-sessions page", () => {
  it("lets an admin in", () => {
    expect(renderToStaticMarkup(<AdminAgentSessionsPage />)).toContain("Show events");
  });

  it("shows access denied to operators and everyone else", () => {
    for (const role of ["operator", "agent", null, "artist"]) {
      auth.value = { token: "token", role, status: "authenticated" };
      const html = renderToStaticMarkup(<AdminAgentSessionsPage />);
      expect(html).toContain("Admins only");
      expect(html).not.toContain("<form");
    }
  });
});

describe("/admin/agent-sessions/[sessionId] page", () => {
  it("lets an admin in", () => {
    expect(renderToStaticMarkup(<AdminAgentSessionEventsPage />)).toContain("Loading session events");
  });

  it("shows access denied to an operator without asking the server for events", () => {
    auth.value = { token: "token", role: "operator", status: "authenticated" };
    expect(renderToStaticMarkup(<AdminAgentSessionEventsPage />)).toContain("Admins only");
    expect(api.getAdminAgentSessionEvents).not.toHaveBeenCalled();
  });

  it("refuses a malformed id without a request", () => {
    nav.sessionId = "not a session";
    expect(renderToStaticMarkup(<AdminAgentSessionEventsPage />)).toContain("This is not a session id");
    expect(api.getAdminAgentSessionEvents).not.toHaveBeenCalled();
  });
});
