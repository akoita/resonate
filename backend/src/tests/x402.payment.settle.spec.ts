/**
 * X402PaymentService.verifyAndSettle against a stubbed facilitator: a payment
 * is granted only when /verify accepts it AND /settle confirms settlement.
 * Before this, a failed /settle was logged and the purchase went ahead.
 */
import path from "node:path";
import { X402PaymentService } from "../modules/x402/x402.payment.service";
import type { X402Config } from "../modules/x402/x402.config";

const { encodePaymentSignatureHeader }: { encodePaymentSignatureHeader: (payload: unknown) => string } = require(
  path.join(process.cwd(), "node_modules/@x402/core/dist/cjs/http/index.js"),
);

const config = {
  enabled: true,
  facilitatorUrl: "https://facilitator.example.test",
  network: "eip155:84532",
  chainId: 84532,
  payoutAddress: `0x${"a".repeat(40)}`,
} as X402Config;

const requirements = { scheme: "exact", network: "eip155:84532", amount: "50000" };
const proof = encodePaymentSignatureHeader({
  x402Version: 2,
  accepted: requirements,
  payload: { signature: "0x01", authorization: {} },
});

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("X402PaymentService.verifyAndSettle", () => {
  const service = new X402PaymentService(config);
  let fetchMock: jest.SpyInstance;
  const respond = (settle: () => Promise<unknown>) => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/verify")) return json(200, { isValid: true });
      return settle();
    });
  };

  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch" as never);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("grants only when the facilitator confirms settlement", async () => {
    respond(async () => json(200, { success: true, transaction: "0xabc", network: "eip155:84532" }));
    await expect(service.verifyAndSettle(proof, requirements)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses when /settle answers non-2xx", async () => {
    respond(async () => json(502, { error: "upstream" }));
    const result = await service.verifyAndSettle(proof, requirements);
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toMatch(/^settle_failed: facilitator_http_502/);
  });

  it("refuses when /settle answers 2xx without success, keeping the facilitator's reason", async () => {
    respond(async () => json(200, { success: false, errorReason: "insufficient_funds" }));
    await expect(service.verifyAndSettle(proof, requirements)).resolves.toEqual({
      ok: false,
      reason: "settle_failed: insufficient_funds",
    });

    respond(async () => json(200, {}));
    await expect(service.verifyAndSettle(proof, requirements)).resolves.toEqual({
      ok: false,
      reason: "settle_failed: settlement_not_confirmed",
    });

    respond(async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); }, text: async () => "" }));
    await expect(service.verifyAndSettle(proof, requirements)).resolves.toEqual({
      ok: false,
      reason: "settle_failed: settlement_not_confirmed",
    });
  });

  it("refuses when the facilitator cannot be reached for /settle", async () => {
    respond(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(service.verifyAndSettle(proof, requirements)).resolves.toEqual({
      ok: false,
      reason: "settle_failed: facilitator_unreachable: ECONNRESET",
    });
  });

  it("never settles a payment /verify rejected", async () => {
    fetchMock.mockImplementation(async () => json(200, { isValid: false, invalidReason: "invalid_signature" }));
    await expect(service.verifyAndSettle(proof, requirements)).resolves.toEqual({
      ok: false,
      reason: "invalid_signature",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
