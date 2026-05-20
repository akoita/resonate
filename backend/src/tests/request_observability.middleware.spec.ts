import { EventEmitter } from "events";
import { requestObservabilityMiddleware } from "../modules/shared/request_observability.middleware";
import { normalizeRequestId, redactForLog, writeStructuredLog } from "../modules/shared/structured_logging";

describe("request observability middleware", () => {
  it("propagates inbound request IDs and logs completion metadata without sensitive headers", () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const res = new EventEmitter() as any;
    res.statusCode = 200;
    res.setHeader = jest.fn();
    const req = {
      method: "GET",
      path: "/api/stems/stem-1/x402",
      url: "/api/stems/stem-1/x402?download=1",
      headers: {
        "x-request-id": "req-test",
        authorization: "Bearer secret",
        "payment-signature": "proof-secret",
      },
    } as any;
    const next = jest.fn();

    requestObservabilityMiddleware()(req, res, next);
    res.emit("finish");

    expect(next).toHaveBeenCalled();
    expect(req.requestId).toBe("req-test");
    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", "req-test");

    const payload = JSON.parse(info.mock.calls[0][0]);
    expect(payload).toEqual(
      expect.objectContaining({
        event: "http.request.completed",
        requestId: "req-test",
        method: "GET",
        path: "/api/stems/stem-1/x402",
        statusCode: 200,
        hasAuth: true,
        paymentHeaderType: "payment-signature",
      }),
    );
    expect(JSON.stringify(payload)).not.toContain("proof-secret");
    expect(JSON.stringify(payload)).not.toContain("Bearer secret");

    info.mockRestore();
  });

  it("generates a request ID when the inbound value is missing or unusable", () => {
    expect(normalizeRequestId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(normalizeRequestId(" ".repeat(4))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("redacts sensitive fields from structured log payloads", () => {
    expect(
      redactForLog({
        authorization: "Bearer secret",
        paymentSignature: "proof",
        nested: { apiKey: "secret", stemId: "stem-1" },
      }),
    ).toEqual({
      authorization: "[redacted]",
      paymentSignature: "[redacted]",
      nested: { apiKey: "[redacted]", stemId: "stem-1" },
    });
  });

  it("writes JSON structured logs with service and timestamp defaults", () => {
    const lines: string[] = [];

    writeStructuredLog(
      {
        level: "info",
        event: "test.event",
        message: "test message",
        privateKey: "secret",
      },
      (line) => lines.push(line),
    );

    const payload = JSON.parse(lines[0]);
    expect(payload.service).toBe("resonate-backend");
    expect(payload.timestamp).toEqual(expect.any(String));
    expect(payload.privateKey).toBe("[redacted]");
  });
});

