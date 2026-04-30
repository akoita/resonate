import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { payStemWithX402, X402PaymentError } from "./x402Pay";

const noopSigner = {
  address: "0x0000000000000000000000000000000000000001" as const,
  signTypedData: vi.fn(),
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  noopSigner.signTypedData.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("payStemWithX402", () => {
  it("throws X402PaymentError when initial response is neither 402 nor ok", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("server error", { status: 500 }),
    );

    await expect(
      payStemWithX402({ stemId: "stem_1", signer: noopSigner }),
    ).rejects.toBeInstanceOf(X402PaymentError);
  });

  it("hands back audio directly when the server returns 200 with no challenge", async () => {
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });
    const receipt = {
      receiptId: "receipt_1",
      payment: {
        amountUsd: "0.75",
        settlementAmount: "0.75",
        currency: "USDC",
      },
    };
    fetchMock.mockResolvedValueOnce(
      new Response(audio, {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "content-disposition": 'attachment; filename="kick.mp3"',
          "x-resonate-receipt-id": "receipt_1",
          "x-resonate-receipt": Buffer.from(JSON.stringify(receipt)).toString("base64url"),
        },
      }),
    );

    const result = await payStemWithX402({ stemId: "stem_1", signer: noopSigner });

    expect(result.filename).toBe("kick.mp3");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.receiptId).toBe("receipt_1");
    expect(result.receipt?.payment?.settlementAmount).toBe("0.75");
    expect(noopSigner.signTypedData).not.toHaveBeenCalled();
  });

  it("emits status callbacks in challenging → … order on the 402 path", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ x402Version: 2, accepts: [] }), {
        status: 402,
        headers: { "PAYMENT-REQUIRED": "" },
      }),
    );
    const statuses: string[] = [];

    await expect(
      payStemWithX402({
        stemId: "stem_1",
        signer: noopSigner,
        onStatus: (s) => statuses.push(s),
      }),
    ).rejects.toBeInstanceOf(Error);

    expect(statuses[0]).toBe("challenging");
  });
});
