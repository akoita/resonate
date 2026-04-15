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
      doc.paths["/api/stems/{stemId}/x402"].get.responses["402"],
    ).toBeDefined();
    expect(
      doc.components.schemas.X402PaymentRequired.properties.accepts,
    ).toBeDefined();
    expect(
      doc.paths["/api/stem-pricing/batch-get"].get.responses["200"].content[
        "application/json"
      ].schema.type,
    ).toBe("object");
    expect(
      doc.components.schemas.StemPricing.properties.remixLicenseUsd,
    ).toBeDefined();
    expect(
      doc.components.schemas.StemPricing.properties.commercialLicenseUsd,
    ).toBeDefined();
    expect(
      doc.components.schemas.X402PaymentRequired.required,
    ).toContain("x-payment");
    expect(
      doc.components.schemas.X402PaymentRequired.properties["x-payment"],
    ).toBeDefined();
  });
});
