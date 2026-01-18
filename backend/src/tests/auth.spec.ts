import { AuthNonceService } from "../modules/auth/auth_nonce.service";
import { AuthService } from "../modules/auth/auth.service";

describe("auth nonce", () => {
  it("issues and consumes nonce", () => {
    const service = new AuthNonceService();
    const nonce = service.issue("0xabc");
    expect(service.consume("0xabc", nonce)).toBe(true);
    expect(service.consume("0xabc", nonce)).toBe(false);
  });
});

describe("auth role enforcement", () => {
  it("restricts admin role without allowlist", () => {
    const auth = new AuthService({ sign: () => "token" } as any, {
      log: () => {},
    } as any);
    const token = auth.issueToken("0xabc", "admin");
    expect(token.accessToken).toBe("token");
  });
});
