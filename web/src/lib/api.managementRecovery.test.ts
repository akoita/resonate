import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE,
  canRequestManagementTransferRecovery,
  getMyManagementRecoveries,
  getPendingManagementRecoveries,
  requestManagementTransferRecovery,
  reviewManagementRecovery,
  type ManagementTransferRecovery,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("management recovery API", () => {
  it("uses the authenticated recovery routes and sends the specified mutation payloads", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ transfers: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ requests: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getMyManagementRecoveries("session-token")).resolves.toEqual({ transfers: [] });
    await expect(getPendingManagementRecoveries("session-token")).resolves.toEqual({ requests: [] });
    await requestManagementTransferRecovery("session-token", "transfer/one", "Evidence text");
    await reviewManagementRecovery("session-token", "recovery-one", {
      decision: "approve",
      note: "Reviewed the submitted evidence.",
    });

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      `${API_BASE}/management/recoveries/me`,
      `${API_BASE}/management/recoveries/pending`,
      `${API_BASE}/management/transfers/transfer%2Fone/recovery-requests`,
      `${API_BASE}/management/recoveries/recovery-one`,
    ]);
    expect(calls[0]?.[1].cache).toBe("no-store");
    expect(calls[1]?.[1].cache).toBe("no-store");
    expect(new Headers(calls[2]?.[1].headers).get("Authorization")).toBe("Bearer session-token");
    expect(calls[2]?.[1].method).toBe("POST");
    expect(JSON.parse(String(calls[2]?.[1].body))).toEqual({ evidence: "Evidence text" });
    expect(calls[3]?.[1].method).toBe("PATCH");
    expect(JSON.parse(String(calls[3]?.[1].body))).toEqual({
      decision: "approve",
      note: "Reviewed the submitted evidence.",
    });
  });

  it("only offers a request when the transfer is eligible and no pending or approved request exists", () => {
    const transfer: ManagementTransferRecovery = {
      id: "transfer-1",
      resourceType: "release",
      resourceIds: ["release-1"],
      resources: [{ id: "release-1", name: "First Light" }],
      acceptedAt: "2026-01-01T00:00:00.000Z",
      eligible: true,
      recovery: null,
    };

    expect(canRequestManagementTransferRecovery(transfer)).toBe(true);
    expect(canRequestManagementTransferRecovery({ ...transfer, eligible: false })).toBe(false);
    expect(canRequestManagementTransferRecovery({
      ...transfer,
      recovery: { id: "recovery-1", status: "pending", reviewedAt: null },
    })).toBe(false);
    expect(canRequestManagementTransferRecovery({
      ...transfer,
      recovery: { id: "recovery-1", status: "approved", reviewedAt: "2026-01-02T00:00:00.000Z" },
    })).toBe(false);
    expect(canRequestManagementTransferRecovery({
      ...transfer,
      recovery: { id: "recovery-1", status: "rejected", reviewedAt: "2026-01-02T00:00:00.000Z" },
    })).toBe(true);
  });
});
