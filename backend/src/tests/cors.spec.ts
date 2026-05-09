import { getCorsAllowedOrigins } from "../config/cors";

describe("getCorsAllowedOrigins", () => {
  it("includes local frontend defaults", () => {
    expect(getCorsAllowedOrigins({})).toEqual([
      "http://localhost:3001",
      "http://localhost:3000",
    ]);
  });

  it("adds origins from CORS and frontend env vars", () => {
    expect(
      getCorsAllowedOrigins({
        CORS_ORIGIN: "https://app.example.com, https://admin.example.com/",
        FRONTEND_URL: "https://app.example.com/app",
        WEBAUTHN_ORIGIN: "https://passkeys.example.com",
      }),
    ).toEqual([
      "http://localhost:3001",
      "http://localhost:3000",
      "https://app.example.com",
      "https://admin.example.com",
      "https://passkeys.example.com",
    ]);
  });

  it("supports plural CORS_ORIGINS for compatibility", () => {
    expect(
      getCorsAllowedOrigins({
        CORS_ORIGINS: "https://one.example.com,https://two.example.com/",
      }),
    ).toEqual([
      "http://localhost:3001",
      "http://localhost:3000",
      "https://one.example.com",
      "https://two.example.com",
    ]);
  });
});
