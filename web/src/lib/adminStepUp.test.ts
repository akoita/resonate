/**
 * #2173 — the browser half of the admin step-up: the passkey is asked for only
 * when the server requires it, then the action is retried once with the proof.
 * `fetch` is stubbed the way the other API tests stub it, so the real request
 * functions (`suspendAccount`, `sendBroadcastNotice`, ...) are what run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminStepUpCancelledError,
  AdminStepUpRefusedError,
  STEP_UP_SAFETY_MARGIN_MS,
  clearStepUpProof,
  freshStepUpProof,
  rememberStepUpProof,
  stepUpCodeOf,
  withAdminStepUp,
} from "./adminStepUp";
import { ADMIN_STEP_UP_HEADER, ApiRequestError, API_BASE, closeAccount, sendBroadcastNotice, suspendAccount } from "./api";

const TOKEN = "session-token";
const CHALLENGE = {
  address: "0xabc0000000000000000000000000000000000001",
  message: "Resonate: confirm an admin action\n\nNonce: n-1",
  challengeToken: "challenge-token-0123456789",
  expiresAt: "2026-10-24T12:02:00.000Z",
};

function proofResponse(proof = "proof-1", ttlMs = 300_000) {
  return { proof, expiresAt: new Date(Date.now() + ttlMs).toISOString(), ttlSeconds: 300 };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const stepUpRequired = (code = "step_up_required") =>
  jsonResponse({ statusCode: 403, code, message: "This action needs a fresh confirmation." }, 403);

const ACCOUNT = { userId: "user-2", status: "suspended" };

let fetchMock: ReturnType<typeof vi.fn>;
const signMessage = vi.fn();

function routes(handlers: Record<string, (init: RequestInit, call: number) => Response>) {
  const counts: Record<string, number> = {};
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const path = url.replace(API_BASE, "");
    const handler = handlers[path];
    if (!handler) throw new Error(`Unexpected request to ${path}`);
    counts[path] = (counts[path] ?? 0) + 1;
    return handler(init ?? {}, counts[path]);
  });
}

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

describe("withAdminStepUp (#2173)", () => {
  it("does not prompt when the server does not ask", async () => {
    routes({ "/admin/accounts/user-2/suspend": () => jsonResponse(ACCOUNT) });
    const onPrompt = vi.fn();

    const result = await withAdminStepUp({ token: TOKEN, signMessage, onPrompt }, (proof) =>
      suspendAccount(TOKEN, "user-2", { reason: "abuse" }, proof),
    );

    expect(result).toEqual(ACCOUNT);
    expect(signMessage).not.toHaveBeenCalled();
    expect(onPrompt).not.toHaveBeenCalled();
    expect(paths()).toEqual(["/admin/accounts/user-2/suspend"]);
  });

  it("asks for the passkey only after the server requires it, signs the server's words, and retries with the proof", async () => {
    routes({
      "/admin/accounts/user-2/suspend": (init, call) =>
        call === 1 ? stepUpRequired() : jsonResponse(ACCOUNT),
      "/admin/step-up/challenge": () => jsonResponse(CHALLENGE),
      "/admin/step-up/verify": () => jsonResponse(proofResponse("proof-1")),
    });
    const onPrompt = vi.fn();

    const result = await withAdminStepUp({ token: TOKEN, signMessage, onPrompt }, (proof) =>
      suspendAccount(TOKEN, "user-2", { reason: "abuse" }, proof),
    );

    expect(result).toEqual(ACCOUNT);
    expect(paths()).toEqual([
      "/admin/accounts/user-2/suspend",
      "/admin/step-up/challenge",
      "/admin/step-up/verify",
      "/admin/accounts/user-2/suspend",
    ]);
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledWith(CHALLENGE.message);

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    // The first attempt carries no proof; the retry carries it.
    expect(headerOf(calls[0][1], ADMIN_STEP_UP_HEADER)).toBeNull();
    expect(headerOf(calls[3][1], ADMIN_STEP_UP_HEADER)).toBe("proof-1");
    // The verification sends the address and token the server issued, plus the signature.
    expect(JSON.parse(String(calls[2][1].body))).toEqual({
      address: CHALLENGE.address,
      signature: "0xsigned",
      challengeToken: CHALLENGE.challengeToken,
    });
    expect(headerOf(calls[2][1], "Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("prompts once per window: the next destructive action reuses the proof", async () => {
    routes({
      "/admin/accounts/user-2/suspend": (init, call) => (call === 1 ? stepUpRequired() : jsonResponse(ACCOUNT)),
      "/admin/accounts/user-2/close": () => jsonResponse(ACCOUNT),
      "/notices/broadcast": () => jsonResponse({ id: "n-1" }, 201),
      "/admin/step-up/challenge": () => jsonResponse(CHALLENGE),
      "/admin/step-up/verify": () => jsonResponse(proofResponse("proof-1")),
    });
    const ctx = { token: TOKEN, signMessage };

    await withAdminStepUp(ctx, (proof) => suspendAccount(TOKEN, "user-2", { reason: "abuse" }, proof));
    await withAdminStepUp(ctx, (proof) => closeAccount(TOKEN, "user-2", { reason: "fraud" }, proof));
    await withAdminStepUp(ctx, (proof) =>
      sendBroadcastNotice(TOKEN, { audience: "all", category: "policy", title: "t", body: "b" }, proof),
    );

    expect(signMessage).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    const sent = calls.filter(([url]) => url.endsWith("/close") || url.endsWith("/broadcast"));
    expect(sent.map(([, init]) => headerOf(init, ADMIN_STEP_UP_HEADER))).toEqual(["proof-1", "proof-1"]);
  });

  it("prompts again when the server says the remembered proof has expired", async () => {
    rememberStepUpProof(TOKEN, proofResponse("old-proof"));
    routes({
      "/admin/accounts/user-2/suspend": (init) =>
        headerOf(init, ADMIN_STEP_UP_HEADER) === "proof-2" ? jsonResponse(ACCOUNT) : stepUpRequired("step_up_expired"),
      "/admin/step-up/challenge": () => jsonResponse(CHALLENGE),
      "/admin/step-up/verify": () => jsonResponse(proofResponse("proof-2")),
    });

    await withAdminStepUp({ token: TOKEN, signMessage }, (proof) =>
      suspendAccount(TOKEN, "user-2", { reason: "abuse" }, proof),
    );

    const sent = (fetchMock.mock.calls as [string, RequestInit][]).filter(([url]) => url.endsWith("/suspend"));
    expect(sent.map(([, init]) => headerOf(init, ADMIN_STEP_UP_HEADER))).toEqual(["old-proof", "proof-2"]);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(freshStepUpProof(TOKEN)).toBe("proof-2");
  });

  it("stops sending a remembered proof shortly before it expires, and never to another session", () => {
    rememberStepUpProof(TOKEN, proofResponse("p", 300_000));
    expect(freshStepUpProof(TOKEN)).toBe("p");
    expect(freshStepUpProof(TOKEN, Date.now() + 300_000 - STEP_UP_SAFETY_MARGIN_MS + 1_000)).toBeUndefined();
    expect(freshStepUpProof("another-session")).toBeUndefined();
    clearStepUpProof();
    expect(freshStepUpProof(TOKEN)).toBeUndefined();
  });

  it("treats a dismissed passkey prompt as a quiet cancel and sends nothing further", async () => {
    signMessage.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    routes({
      "/admin/accounts/user-2/close": () => stepUpRequired(),
      "/admin/step-up/challenge": () => jsonResponse(CHALLENGE),
    });

    await expect(
      withAdminStepUp({ token: TOKEN, signMessage }, (proof) => closeAccount(TOKEN, "user-2", { reason: "fraud" }, proof)),
    ).rejects.toBeInstanceOf(AdminStepUpCancelledError);

    expect(paths()).toEqual(["/admin/accounts/user-2/close", "/admin/step-up/challenge"]);
    expect(freshStepUpProof(TOKEN)).toBeUndefined();
  });

  it("reports a failing authenticator and a refused signature as a refusal, not a session problem", async () => {
    routes({
      "/admin/accounts/user-2/close": () => stepUpRequired(),
      "/admin/step-up/challenge": () => jsonResponse(CHALLENGE),
      "/admin/step-up/verify": () => jsonResponse({ statusCode: 400, message: "no" }, 400),
    });
    await expect(
      withAdminStepUp({ token: TOKEN, signMessage }, (proof) => closeAccount(TOKEN, "user-2", { reason: "fraud" }, proof)),
    ).rejects.toBeInstanceOf(AdminStepUpRefusedError);

    signMessage.mockRejectedValue(new Error("authenticator exploded"));
    await expect(
      withAdminStepUp({ token: TOKEN, signMessage }, (proof) => closeAccount(TOKEN, "user-2", { reason: "fraud" }, proof)),
    ).rejects.toBeInstanceOf(AdminStepUpRefusedError);
  });

  it("does not loop: a second step-up refusal after confirming is surfaced", async () => {
    routes({
      "/admin/accounts/user-2/close": () => stepUpRequired("step_up_invalid"),
      "/admin/step-up/challenge": () => jsonResponse(CHALLENGE),
      "/admin/step-up/verify": () => jsonResponse(proofResponse()),
    });
    await expect(
      withAdminStepUp({ token: TOKEN, signMessage }, (proof) => closeAccount(TOKEN, "user-2", { reason: "fraud" }, proof)),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it("passes every other failure straight through without prompting", async () => {
    routes({
      "/admin/accounts/user-2/close": () => jsonResponse({ statusCode: 403, message: "Admin accounts cannot be closed" }, 403),
    });
    await expect(
      withAdminStepUp({ token: TOKEN, signMessage }, (proof) => closeAccount(TOKEN, "user-2", { reason: "fraud" }, proof)),
    ).rejects.toMatchObject({ status: 403 });
    expect(signMessage).not.toHaveBeenCalled();

    routes({ "/admin/accounts/user-2/close": () => jsonResponse({ statusCode: 500, message: "boom" }, 500) });
    await expect(
      withAdminStepUp({ token: TOKEN, signMessage }, (proof) => closeAccount(TOKEN, "user-2", { reason: "fraud" }, proof)),
    ).rejects.toMatchObject({ status: 500 });
    expect(signMessage).not.toHaveBeenCalled();
  });
});

describe("stepUpCodeOf", () => {
  it("reads only the three step-up codes on a 403", () => {
    for (const code of ["step_up_required", "step_up_expired", "step_up_invalid"]) {
      expect(stepUpCodeOf(new ApiRequestError("x", 403, { code }))).toBe(code);
    }
    expect(stepUpCodeOf(new ApiRequestError("x", 403, { code: "account_suspended" }))).toBeNull();
    expect(stepUpCodeOf(new ApiRequestError("x", 401, { code: "step_up_required" }))).toBeNull();
    expect(stepUpCodeOf(new ApiRequestError("x", 403, undefined))).toBeNull();
    expect(stepUpCodeOf(new Error("x"))).toBeNull();
  });
});
