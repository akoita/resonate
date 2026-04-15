import { OpenApiService } from "../modules/openapi/openapi.service";

describe("OpenApiService", () => {
  it("builds a valid document with the current public discovery surfaces", () => {
    const service = new OpenApiService();
    const doc = service.buildDocument("http://localhost:3000") as any;

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "http://localhost:3000" }]);
    expect(doc.info["x-guidance"]).toContain("Resonate");

    expect(doc.paths["/catalog/published"]).toBeDefined();
    expect(doc.paths["/catalog/releases/{releaseId}"]).toBeDefined();
    expect(doc.paths["/catalog/tracks/{trackId}"]).toBeDefined();
    expect(doc.paths["/api/stem-pricing/{stemId}"]).toBeDefined();
    expect(doc.paths["/api/stems/{stemId}/x402"]).toBeDefined();
    expect(doc.paths["/api/stems/{stemId}/x402/info"]).toBeDefined();
    expect(doc.paths["/api/storefront/stems"]).toBeUndefined();
    expect(
      doc.paths["/api/stems/{stemId}/x402"].get["x-payment-info"],
    ).toEqual({
      price: {
        mode: "dynamic",
        currency: "USD",
        min: "0.01",
        max: "50",
      },
      protocols: [
        {
          x402: {
            quoteEndpoint: "/api/stems/{stemId}/x402/info",
          },
        },
      ],
    });

    expect(
      doc.paths["/api/stems/{stemId}/x402"].get.responses["402"],
    ).toBeDefined();
    expect(
      doc.components.schemas.X402PaymentRequired.properties.accepts,
    ).toBeDefined();
  });

  it("builds a well-known x402 discovery document", () => {
    const service = new OpenApiService();
    const doc = service.buildWellKnownDocument("http://localhost:3000") as any;

    expect(doc.version).toBe(1);
    expect(doc.protocol).toBe("x402");
    expect(doc.openapi).toBe("http://localhost:3000/openapi.json");
    expect(doc.resources).toEqual([
      "GET http://localhost:3000/api/stems/{stemId}/x402",
    ]);
    expect(doc.instructions).toContain("/api/stems/{stemId}/x402");
  });
});
