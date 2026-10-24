/**
 * #2362 — the admin actions that became destructive-gated send the step-up proof
 * in `X-Admin-Step-Up` when they have one, ask for it only when the server says
 * so, and send nothing extra otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminStepUpCancelledError, clearStepUpProof, withAdminStepUp } from "./adminStepUp";
import {
  ADMIN_STEP_UP_HEADER,
  API_BASE,
  grantCreditRequest,
  resolveCommunityModerationReport,
  reviewManagementRecovery,
} from "./api";
import {
  confirmShowCampaignBooking,
  confirmShowCampaignFulfillment,
  resolveShowCampaignDispute,
  type Campaign,
} from "./shows";

const TOKEN = "session-token";
const CHALLENGE = {
  address: "0xabc0000000000000000000000000000000000001",
  message: "Resonate: confirm an admin action\n\nNonce: n-1",
  challengeToken: "challenge-token-0123456789",
  expiresAt: "2026-10-24T12:02:00.000Z",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const required = () => json({ statusCode: 403, code: "step_up_required", message: "needs confirmation" }, 403);
const proofBody = () => ({ proof: "proof-1", expiresAt: new Date(Date.now() + 300_000).toISOString(), ttlSeconds: 300 });

let fetchMock: ReturnType<typeof vi.fn>;
const signMessage = vi.fn();
const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name);
const paths = () => (fetchMock.mock.calls as [string][]).map(([url]) => url.replace(API_BASE, ""));

beforeEach(() => {
  clearStepUpProof();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  signMessage.mockReset();
  signMessage.mockResolvedValue("0xsigned");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const calls = () => fetchMock.mock.calls as [string, RequestInit][];

describe("gated admin calls carry the proof (#2362)", () => {
  it.each([
    ["grantCreditRequest", "/credits/requests/req%201/grant", (proof?: string) => grantCreditRequest(TOKEN, "req 1", { amountCents: 500 }, proof)],
    ["reviewManagementRecovery", "/management/recoveries/rec-1", (proof?: string) => reviewManagementRecovery(TOKEN, "rec-1", { decision: "approve", note: "ok" }, proof)],
    ["resolveCommunityModerationReport", "/admin/community/moderation/reports/rep-1", (proof?: string) => resolveCommunityModerationReport(TOKEN, "rep-1", { action: "ban_member" }, proof)],
  ])("%s sends the header only when it has a proof", async (_name, path, call) => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await call(undefined);
    await call("proof-9");
    expect(paths()).toEqual([path, path]);
    expect(headerOf(calls()[0][1], ADMIN_STEP_UP_HEADER)).toBeNull();
    expect(headerOf(calls()[1][1], ADMIN_STEP_UP_HEADER)).toBe("proof-9");
    expect(headerOf(calls()[1][1], "Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headerOf(calls()[1][1], "Content-Type")).toBe("application/json");
  });

  it.each([
    ["grantCreditRequest", (proof?: string) => grantCreditRequest(TOKEN, "req-1", { amountCents: 500, reason: " promo " }, proof), '{"amountCents":500,"reason":"promo"}'],
    ["reviewManagementRecovery", (proof?: string) => reviewManagementRecovery(TOKEN, "rec-1", { decision: "reject", note: "n" }, proof), '{"decision":"reject","note":"n"}'],
    ["resolveCommunityModerationReport", (proof?: string) => resolveCommunityModerationReport(TOKEN, "rep-1", { action: "no_action" }, proof), '{"action":"no_action"}'],
  ] as Array<[string, (proof?: string) => Promise<unknown>, string]>)("%s prompts once on step_up_required, then retries with the proof and the same body", async (_name, call, body) => {
    fetchMock.mockImplementationOnce(async () => required());
    fetchMock.mockImplementationOnce(async () => json(CHALLENGE));
    fetchMock.mockImplementationOnce(async () => json(proofBody()));
    fetchMock.mockImplementationOnce(async () => json({ ok: true }));
    const onPrompt = vi.fn();

    await withAdminStepUp({ token: TOKEN, signMessage, onPrompt }, call);

    expect(paths().slice(1, 3)).toEqual(["/admin/step-up/challenge", "/admin/step-up/verify"]);
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledWith(CHALLENGE.message);
    expect(headerOf(calls()[0][1], ADMIN_STEP_UP_HEADER)).toBeNull();
    expect(headerOf(calls()[3][1], ADMIN_STEP_UP_HEADER)).toBe("proof-1");
    expect(calls()[0][1].body).toBe(body);
    expect(calls()[3][1].body).toBe(body);
  });

  it("a dismissed passkey prompt sends nothing more and reports nothing changed", async () => {
    fetchMock.mockImplementationOnce(async () => required());
    fetchMock.mockImplementationOnce(async () => json(CHALLENGE));
    signMessage.mockRejectedValueOnce(Object.assign(new Error("The operation was cancelled"), { name: "NotAllowedError" }));

    await expect(
      withAdminStepUp({ token: TOKEN, signMessage }, (proof) =>
        reviewManagementRecovery(TOKEN, "rec-1", { decision: "approve", note: "ok" }, proof),
      ),
    ).rejects.toBeInstanceOf(AdminStepUpCancelledError);
    expect(paths()).toEqual(["/management/recoveries/rec-1", "/admin/step-up/challenge"]);
  });
});

// #2380: the Shows money-release actions are step-up gated too.
describe("Shows money-release actions carry the proof (#2380)", () => {
  const campaign = { backendId: "camp 1" } as Campaign;
  const backendCampaign = { id: "camp-1", slug: "paris", title: "Paris", artistDisplayName: "Artist", city: "Paris", country: "FR", status: "funded", deadline: "2026-12-01T00:00:00.000Z" };
  const deniedWithoutProof = () => json({ statusCode: 403, code: "step_up_required", message: "needs confirmation" }, 403);

  const actions: Array<[string, string, (proof?: string) => Promise<unknown>, string]> = [
    [
      "confirmShowCampaignBooking",
      "/shows/campaigns/camp%201/confirm-booking",
      (proof) => confirmShowCampaignBooking({ campaign, token: TOKEN, evidenceBundleId: "ev-1", reason: "r", stepUpProof: proof }),
      '{"evidenceBundleId":"ev-1","reason":"r"}',
    ],
    [
      "confirmShowCampaignFulfillment",
      "/shows/campaigns/camp%201/confirm-fulfillment",
      (proof) => confirmShowCampaignFulfillment({ campaign, token: TOKEN, evidenceBundleId: "ev-2", reason: "r", stepUpProof: proof }),
      '{"evidenceBundleId":"ev-2","reason":"r"}',
    ],
    [
      "resolveShowCampaignDispute",
      "/shows/campaigns/camp%201/dispute/d-1/resolve",
      (proof) => resolveShowCampaignDispute({ campaign, token: TOKEN, disputeId: "d-1", outcome: "upheld", operatorNote: "n", stepUpProof: proof }),
      '{"outcome":"upheld","operatorNote":"n"}',
    ],
  ];

  it.each(actions)("%s sends the header only when it has a proof", async (_name, path, call) => {
    fetchMock.mockImplementation(async () => json(backendCampaign));
    await call(undefined);
    await call("proof-9");
    expect(paths()).toEqual([path, path]);
    expect(headerOf(calls()[0][1], ADMIN_STEP_UP_HEADER)).toBeNull();
    expect(headerOf(calls()[1][1], ADMIN_STEP_UP_HEADER)).toBe("proof-9");
    expect(headerOf(calls()[1][1], "Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it.each(actions)("%s prompts once on step_up_required, then retries with the proof and the same body", async (_name, _path, call, body) => {
    fetchMock.mockImplementationOnce(async () => deniedWithoutProof());
    fetchMock.mockImplementationOnce(async () => json(CHALLENGE));
    fetchMock.mockImplementationOnce(async () => json(proofBody()));
    fetchMock.mockImplementationOnce(async () => json(backendCampaign));
    const onPrompt = vi.fn();

    await withAdminStepUp({ token: TOKEN, signMessage, onPrompt }, call);

    expect(paths().slice(1, 3)).toEqual(["/admin/step-up/challenge", "/admin/step-up/verify"]);
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(headerOf(calls()[0][1], ADMIN_STEP_UP_HEADER)).toBeNull();
    expect(headerOf(calls()[3][1], ADMIN_STEP_UP_HEADER)).toBe("proof-1");
    expect(calls()[0][1].body).toBe(body);
    expect(calls()[3][1].body).toBe(body);
  });

  it.each(actions)("%s: a dismissed passkey prompt sends nothing more and reports nothing changed", async (_name, path, call) => {
    fetchMock.mockImplementationOnce(async () => deniedWithoutProof());
    fetchMock.mockImplementationOnce(async () => json(CHALLENGE));
    signMessage.mockRejectedValueOnce(Object.assign(new Error("The operation was cancelled"), { name: "NotAllowedError" }));

    await expect(withAdminStepUp({ token: TOKEN, signMessage }, call)).rejects.toBeInstanceOf(AdminStepUpCancelledError);
    expect(paths()).toEqual([path, "/admin/step-up/challenge"]);
  });

  it("a refusal that is not a step-up answer keeps the server text as the message", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("Campaign is not funded", { status: 400 }));
    await expect(
      withAdminStepUp({ token: TOKEN, signMessage }, (proof) =>
        confirmShowCampaignBooking({ campaign, token: TOKEN, stepUpProof: proof }),
      ),
    ).rejects.toThrow("Campaign is not funded");
    expect(paths()).toEqual(["/shows/campaigns/camp%201/confirm-booking"]);
  });
});
