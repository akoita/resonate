import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BUYER = "0x1111111111111111111111111111111111111111";
const PARALLEL_ACCOUNT = "0x3333333333333333333333333333333333333333";
const TX_HASH = `0x${"a".repeat(64)}`;
const SIGNATURE = "0xfeedbeef";

const account = {
  address: BUYER as `0x${string}`,
  signTypedData: vi.fn(async () => SIGNATURE as `0x${string}`),
};

vi.mock("./x402KernelAccount", () => ({
  getX402KernelAccount: vi.fn(async () => account),
}));

vi.mock("./bundlerConfig", () => ({
  getBundlerUrl: () => "http://bundler.test",
  isPaymasterEnabled: () => false,
}));

vi.mock("@zerodev/sdk", () => ({
  createZeroDevPaymasterClient: vi.fn(),
  createKernelAccountClient: vi.fn(async () => ({
    sendUserOperation: vi.fn(async () => "0xuserop"),
    waitForUserOperationReceipt: vi.fn(async () => ({
      success: true,
      receipt: { transactionHash: TX_HASH, status: "success" },
    })),
  })),
}));

import { payWithX402SmartAccount } from "./x402SmartAccountPay";

const baseInput = {
  submitUrl: "http://api.test/api/stems/stem_1/x402/smart-account",
  webAuthnKey: { id: "passkey" },
  chainId: 84532,
  assetAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const,
  payTo: "0x4444444444444444444444444444444444444444" as const,
  amountUnits: "50000",
  extraHeaders: { Authorization: "Bearer token" },
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function postedBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

describe("payWithX402SmartAccount buyer binding", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    account.address = BUYER as `0x${string}`;
    account.signTypedData.mockClear();
    fetchMock = vi.fn(async () => new Response("audio", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not ask for a signature when the buyer pays from their own account", async () => {
    await payWithX402SmartAccount({
      ...baseInput,
      binding: { buyerId: BUYER, buyerAddresses: [BUYER], resource: { kind: "stem", id: "stem_1" } },
    });

    expect(account.signTypedData).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer token" });
    expect(postedBodies(fetchMock)[0]).toEqual({ txHash: TX_HASH, payer: BUYER });
  });

  it("asks for the binding before any money moves, so a cancelled prompt costs nothing", async () => {
    account.address = PARALLEL_ACCOUNT as `0x${string}`;
    account.signTypedData.mockRejectedValueOnce(new Error("NotAllowedError: cancelled"));
    const sdk = await import("@zerodev/sdk");
    const createClient = vi.mocked(sdk.createKernelAccountClient);
    createClient.mockClear();

    await expect(
      payWithX402SmartAccount({
        ...baseInput,
        binding: { buyerId: BUYER, buyerAddresses: [BUYER], resource: { kind: "stem", id: "stem_1" } },
      }),
    ).rejects.toThrow("cancelled");

    expect(createClient).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs the binding up front when paying from a parallel account", async () => {
    account.address = PARALLEL_ACCOUNT as `0x${string}`;

    await payWithX402SmartAccount({
      ...baseInput,
      binding: { buyerId: BUYER, buyerAddresses: [BUYER], resource: { kind: "stem", id: "stem_1" } },
    });

    expect(account.signTypedData).toHaveBeenCalledWith({
      domain: { name: "Resonate x402", version: "1", chainId: 84532 },
      types: {
        PaymentBinding: [
          { name: "resource", type: "string" },
          { name: "buyer", type: "string" },
        ],
      },
      primaryType: "PaymentBinding",
      message: { resource: "stem:stem_1", buyer: BUYER },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postedBodies(fetchMock)[0]).toEqual({
      txHash: TX_HASH,
      payer: PARALLEL_ACCOUNT,
      payerSignature: SIGNATURE,
    });
  });

  it("signs and retries once when the server does not link the payer", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { code: "payer_not_linked" }))
      .mockResolvedValueOnce(new Response("audio", { status: 200 }));

    const { response } = await payWithX402SmartAccount({
      ...baseInput,
      binding: { buyerId: BUYER, buyerAddresses: [BUYER], resource: { kind: "moment", id: "m_1" } },
    });

    expect(response.status).toBe(200);
    expect(account.signTypedData).toHaveBeenCalledTimes(1);
    expect(postedBodies(fetchMock)).toEqual([
      { txHash: TX_HASH, payer: BUYER },
      { txHash: TX_HASH, payer: BUYER, payerSignature: SIGNATURE },
    ]);
  });

  it("does not retry other refusals", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: "something_else" }));

    const { response } = await payWithX402SmartAccount({
      ...baseInput,
      binding: { buyerId: BUYER, buyerAddresses: [BUYER], resource: { kind: "stem", id: "stem_1" } },
    });

    expect(response.status).toBe(403);
    expect(account.signTypedData).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never signs without a binding", async () => {
    account.address = PARALLEL_ACCOUNT as `0x${string}`;
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: "payer_not_linked" }));

    await payWithX402SmartAccount(baseInput);

    expect(account.signTypedData).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
