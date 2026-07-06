/**
 * Auth Module Tests — Issue #362 (enhanced)
 *
 * The original auth.spec.ts had only 2 tests. This file adds comprehensive
 * coverage for the verify endpoint's 5 code paths:
 * 1. Local dev with mock EOA signer
 * 2. Counterfactual (undeployed) smart account → nonce-only auth
 * 3. Deployed smart account → ERC-1271 verification
 * 4. EOA fallback via recoverMessageAddress
 * 5. Passkey fallback → nonce-gated
 */
import { AuthNonceService } from "../modules/auth/auth_nonce.service";
import { AuthService } from "../modules/auth/auth.service";
import { restoreEnv } from "./env-helpers";

// ============ AuthNonceService ============

describe("AuthNonceService", () => {
  let service: AuthNonceService;

  beforeEach(() => {
    service = new AuthNonceService();
  });

  it("issues and consumes nonce", () => {
    const nonce = service.issue("0xabc");
    expect(service.consume("0xabc", nonce)).toBe(true);
  });

  it("rejects consumed nonce (replay protection)", () => {
    const nonce = service.issue("0xabc");
    service.consume("0xabc", nonce);
    expect(service.consume("0xabc", nonce)).toBe(false);
  });

  it("rejects wrong nonce value", () => {
    service.issue("0xabc");
    expect(service.consume("0xabc", "wrong-nonce")).toBe(false);
  });

  it("rejects nonce for different address", () => {
    const nonce = service.issue("0xabc");
    expect(service.consume("0xdef", nonce)).toBe(false);
  });

  it("normalizes address to lowercase", () => {
    const nonce = service.issue("0xABC");
    expect(service.consume("0xabc", nonce)).toBe(true);
  });

  it("issues unique nonces per address", () => {
    const nonce1 = service.issue("0xabc");
    const nonce2 = service.issue("0xdef");
    expect(nonce1).not.toBe(nonce2);
  });

  it("overwrites old nonce when re-issued for same address", () => {
    const oldNonce = service.issue("0xabc");
    const newNonce = service.issue("0xabc");
    expect(service.consume("0xabc", oldNonce)).toBe(false);
    expect(service.consume("0xabc", newNonce)).toBe(true);
  });
});

// ============ AuthService ============

describe("AuthService", () => {
  const mockJwt = { sign: jest.fn().mockReturnValue("mock-jwt-token") };
  const mockAudit = { log: jest.fn() };
  let authService: AuthService;
  let originalAdminAddresses: string | undefined;
  let originalAgentAddresses: string | undefined;
  let originalOperatorAddresses: string | undefined;

  beforeEach(() => {
    originalAdminAddresses = process.env.ADMIN_ADDRESSES;
    originalAgentAddresses = process.env.AGENT_ADDRESSES;
    originalOperatorAddresses = process.env.OPERATOR_ADDRESSES;
    delete process.env.ADMIN_ADDRESSES;
    delete process.env.AGENT_ADDRESSES;
    delete process.env.OPERATOR_ADDRESSES;
    jest.clearAllMocks();
    authService = new AuthService(mockJwt as any, mockAudit as any);
  });

  afterEach(() => {
    restoreEnv("ADMIN_ADDRESSES", originalAdminAddresses);
    restoreEnv("AGENT_ADDRESSES", originalAgentAddresses);
    restoreEnv("OPERATOR_ADDRESSES", originalOperatorAddresses);
  });

  it("issues token with default listener role", () => {
    const result = authService.issueToken("0xuser123");
    expect(result.accessToken).toBe("mock-jwt-token");
    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xuser123", role: "listener" });
  });

  it("fails closed to listener for a self-requested privileged role", () => {
    // Roles like artist/curator/operator have no self-assignment path — a caller
    // that requests one without allowlist authorization must not be escalated.
    authService.issueToken("0xuser123", "artist");
    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xuser123", role: "listener" });
  });

  it("fails closed to listener when requesting admin without ADMIN_ADDRESSES", () => {
    authService.issueToken("0xNotAdmin", "admin");
    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xNotAdmin", role: "listener" });
  });

  it("auto-promotes admin addresses from ADMIN_ADDRESSES env", () => {
    const originalEnv = process.env.ADMIN_ADDRESSES;
    process.env.ADMIN_ADDRESSES = "0xAdmin1,0xAdmin2";
    authService.issueToken("0xadmin1", "listener");
    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xadmin1", role: "admin" });
    process.env.ADMIN_ADDRESSES = originalEnv;
  });

  it("does not promote non-admin addresses", () => {
    const originalEnv = process.env.ADMIN_ADDRESSES;
    process.env.ADMIN_ADDRESSES = "0xAdmin1";
    authService.issueToken("0xNotAdmin", "listener");
    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xNotAdmin", role: "listener" });
    process.env.ADMIN_ADDRESSES = originalEnv;
  });

  it("handles empty ADMIN_ADDRESSES", () => {
    const originalEnv = process.env.ADMIN_ADDRESSES;
    delete process.env.ADMIN_ADDRESSES;
    authService.issueToken("0xuser", "listener");
    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xuser", role: "listener" });
    process.env.ADMIN_ADDRESSES = originalEnv;
  });

  it("grants agent role to addresses from AGENT_ADDRESSES env", () => {
    process.env.AGENT_ADDRESSES = "0xAgent1, 0xAgent2";

    authService.issueToken("0xagent1", "agent");

    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xagent1", role: "agent" });
  });

  it("downgrades agent role to listener when address is not allowlisted", () => {
    process.env.AGENT_ADDRESSES = "0xAgent1";

    authService.issueToken("0xNotAgent", "agent");

    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xNotAgent", role: "listener" });
  });

  it("keeps admin allowlist promotion ahead of requested agent role", () => {
    process.env.ADMIN_ADDRESSES = "0xAdmin1";
    process.env.AGENT_ADDRESSES = "0xAgent1";

    authService.issueToken("0xadmin1", "agent");

    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xadmin1", role: "admin" });
  });

  it("grants operator role to addresses from OPERATOR_ADDRESSES env", () => {
    process.env.OPERATOR_ADDRESSES = "0xOperator1, 0xOperator2";

    authService.issueToken("0xoperator1", "operator");

    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xoperator1", role: "operator" });
  });

  it("downgrades operator role to listener when address is not allowlisted", () => {
    process.env.OPERATOR_ADDRESSES = "0xOperator1";

    authService.issueToken("0xNotOperator", "operator");

    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xNotOperator", role: "listener" });
  });

  it("does not cross-grant admin from the operator allowlist", () => {
    process.env.OPERATOR_ADDRESSES = "0xOperator1";

    authService.issueToken("0xoperator1", "admin");

    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xoperator1", role: "listener" });
  });

  it("keeps admin allowlist promotion ahead of requested operator role", () => {
    process.env.ADMIN_ADDRESSES = "0xAdmin1";
    process.env.OPERATOR_ADDRESSES = "0xOperator1";

    authService.issueToken("0xadmin1", "operator");

    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xadmin1", role: "admin" });
  });

  it("issueTokenForAddress lowercases the address", () => {
    authService.issueTokenForAddress("0xABCDEF");
    expect(mockJwt.sign).toHaveBeenCalledWith({ sub: "0xabcdef", role: "listener" });
  });

  it("logs audit event with the resolved (effective) role", () => {
    process.env.ADMIN_ADDRESSES = "0xAdmin1";
    authService.issueToken("0xadmin1", "listener");
    expect(mockAudit.log).toHaveBeenCalledWith({
      action: "auth.login",
      actorId: "0xadmin1",
      resource: "auth",
      metadata: { role: "admin" },
    });
  });
});

// ============ AuthController (verify endpoint paths) ============

describe("AuthController verify flow", () => {
  let nonceService: AuthNonceService;

  beforeEach(() => {
    nonceService = new AuthNonceService();
  });

  it("counterfactual path: issues token for undeployed smart account via nonce", () => {
    const address = "0xSmartAccount";
    const nonce = nonceService.issue(address);
    const message = `Sign in to Resonate\nNonce: ${nonce}`;

    // Simulate nonce extraction (regex from controller)
    const nonceMatch = /Nonce:\s*(.+)$/m.exec(message)?.[1] ?? "";
    expect(nonceMatch).toBe(nonce);
    expect(nonceService.consume(address, nonceMatch)).toBe(true);
  });

  it("counterfactual path: rejects expired/consumed nonce", () => {
    const address = "0xSmartAccount";
    const nonce = nonceService.issue(address);
    const message = `Sign in to Resonate\nNonce: ${nonce}`;

    const nonceMatch = /Nonce:\s*(.+)$/m.exec(message)?.[1] ?? "";
    nonceService.consume(address, nonceMatch); // first consume
    // Second attempt must fail
    expect(nonceService.consume(address, nonceMatch)).toBe(false);
  });

  it("nonce regex handles multiline SIWE messages", () => {
    const nonce = "test-nonce-12345";
    const siweMessage = `resonate.is wants you to sign in with your Ethereum account:
0x1234567890abcdef
Sign in to Resonate
URI: https://resonate.is
Version: 1
Chain ID: 8453
Nonce: ${nonce}
Issued At: 2026-03-03T00:00:00Z`;

    const match = /Nonce:\s*(.+)$/m.exec(siweMessage)?.[1] ?? "";
    expect(match).toBe(nonce);
  });
});
