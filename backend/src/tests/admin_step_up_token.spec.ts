/**
 * The signed tokens of the admin step-up (#2173): proof lifetime, binding to the
 * admin, single purpose, tamper resistance, and that neither is a session JWT.
 */
import { sign, verify } from "jsonwebtoken";
import {
  ADMIN_STEP_UP_CHALLENGE_TTL_SECONDS,
  ADMIN_STEP_UP_MAX_TTL_SECONDS,
  ADMIN_STEP_UP_MIN_TTL_SECONDS,
  AdminStepUpTokenService,
} from "../modules/admin_step_up/admin_step_up_token.service";
import { buildAdminStepUpMessage } from "../modules/admin_step_up/admin_step_up_message";

const SECRET = "step-up-unit-secret";
const NOW = Date.parse("2026-10-24T12:00:00.000Z");

function service(env: Record<string, string | undefined> = {}) {
  const values = { JWT_SECRET: SECRET, ...env };
  return new AdminStepUpTokenService({ get: (key: string) => values[key as keyof typeof values] } as any);
}

describe("AdminStepUpTokenService", () => {
  describe("lifetime", () => {
    it("defaults to five minutes and never exceeds it", () => {
      expect(service().ttlSeconds).toBe(300);
      expect(service({ ADMIN_STEP_UP_TTL_SECONDS: "3600" }).ttlSeconds).toBe(ADMIN_STEP_UP_MAX_TTL_SECONDS);
      expect(ADMIN_STEP_UP_MAX_TTL_SECONDS).toBe(300);
    });

    it("can be shortened, but not below the floor, and ignores nonsense", () => {
      expect(service({ ADMIN_STEP_UP_TTL_SECONDS: "120" }).ttlSeconds).toBe(120);
      expect(service({ ADMIN_STEP_UP_TTL_SECONDS: "1" }).ttlSeconds).toBe(ADMIN_STEP_UP_MIN_TTL_SECONDS);
      expect(service({ ADMIN_STEP_UP_TTL_SECONDS: "soon" }).ttlSeconds).toBe(300);
      expect(service({ ADMIN_STEP_UP_TTL_SECONDS: "-5" }).ttlSeconds).toBe(300);
    });

    it("accepts a proof for five minutes and not a second longer", () => {
      const tokens = service();
      const { proof, expiresAt } = tokens.issueProof("admin-1", NOW);
      expect(expiresAt).toBe(NOW + 300_000);
      expect(tokens.checkProof(proof, "admin-1", NOW).ok).toBe(true);
      expect(tokens.checkProof(proof, "admin-1", NOW + 299_000).ok).toBe(true);
      expect(tokens.checkProof(proof, "admin-1", NOW + 300_000)).toEqual({ ok: false, reason: "expired" });
    });

    it("clamps a proof minted under a longer window to the current one", () => {
      const long = service({ ADMIN_STEP_UP_TTL_SECONDS: "300" }).issueProof("admin-1", NOW).proof;
      const short = service({ ADMIN_STEP_UP_TTL_SECONDS: "60" });
      expect(short.checkProof(long, "admin-1", NOW + 59_000).ok).toBe(true);
      expect(short.checkProof(long, "admin-1", NOW + 61_000)).toEqual({ ok: false, reason: "expired" });
    });
  });

  describe("binding", () => {
    it("works only for the admin who earned it", () => {
      const tokens = service();
      const { proof } = tokens.issueProof("admin-1", NOW);
      expect(tokens.checkProof(proof, "admin-2", NOW)).toEqual({ ok: false, reason: "invalid" });
    });

    it("reports a missing proof as missing", () => {
      const tokens = service();
      expect(tokens.checkProof(undefined, "admin-1", NOW)).toEqual({ ok: false, reason: "missing" });
      expect(tokens.checkProof("  ", "admin-1", NOW)).toEqual({ ok: false, reason: "missing" });
    });

    it("is not accepted from a deployment with a different secret", () => {
      const { proof } = service().issueProof("admin-1", NOW);
      expect(service({ JWT_SECRET: "another" }).checkProof(proof, "admin-1", NOW).ok).toBe(false);
    });
  });

  describe("tampering", () => {
    it("rejects an edited payload, an edited mac and malformed tokens", () => {
      const tokens = service();
      const { proof } = tokens.issueProof("admin-1", NOW);
      const [body, mac] = proof.split(".");
      const widened = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(body, "base64url").toString()),
          exp: Math.floor(NOW / 1000) + 99_999,
        }),
      ).toString("base64url");
      for (const bad of [`${widened}.${mac}`, `${body}.${mac.slice(0, -2)}AA`, body, `${body}.${mac}.x`, "", "..", "a.b"]) {
        expect(tokens.checkProof(bad, "admin-1", NOW).ok).toBe(false);
      }
    });
  });

  describe("single purpose", () => {
    it("a challenge is not a proof, and a proof is not a challenge", () => {
      const tokens = service();
      const challenge = tokens.issueChallenge({ userId: "admin-1", address: "0xAbC" }, NOW);
      expect(tokens.checkProof(challenge.token, "admin-1", NOW).ok).toBe(false);
      const { proof } = tokens.issueProof("admin-1", NOW);
      expect(tokens.checkChallenge(proof, "admin-1", NOW).ok).toBe(false);
    });

    it("is never a valid session JWT, and a session JWT is never a proof", () => {
      const tokens = service();
      const { proof } = tokens.issueProof("admin-1", NOW);
      expect(() => verify(proof, SECRET)).toThrow();
      const session = sign({ sub: "admin-1", role: "admin" }, SECRET);
      expect(tokens.checkProof(session, "admin-1").ok).toBe(false);
    });
  });

  describe("challenge", () => {
    it("carries the lowercased address and a fresh nonce for the named admin only", () => {
      const tokens = service();
      const a = tokens.issueChallenge({ userId: "admin-1", address: "0xABCDEF" }, NOW);
      const b = tokens.issueChallenge({ userId: "admin-1", address: "0xABCDEF" }, NOW);
      expect(a.nonce).not.toBe(b.nonce);
      const checked = tokens.checkChallenge(a.token, "admin-1", NOW);
      expect(checked).toMatchObject({ ok: true, address: "0xabcdef", nonce: a.nonce });
      expect(tokens.checkChallenge(a.token, "admin-2", NOW).ok).toBe(false);
    });

    it("expires after two minutes", () => {
      const tokens = service();
      const { token } = tokens.issueChallenge({ userId: "admin-1", address: "0xabc" }, NOW);
      expect(ADMIN_STEP_UP_CHALLENGE_TTL_SECONDS).toBe(120);
      expect(tokens.checkChallenge(token, "admin-1", NOW + 119_000).ok).toBe(true);
      expect(tokens.checkChallenge(token, "admin-1", NOW + 120_000).ok).toBe(false);
    });
  });
});

describe("buildAdminStepUpMessage", () => {
  it("names the action first and is a pure function of the address and nonce", () => {
    const message = buildAdminStepUpMessage({ address: "0xABCDEF0000000000000000000000000000000001", nonce: "n-1" });
    expect(message.split("\n")[0]).toBe("Resonate: confirm an admin action");
    expect(message).toContain("Account: 0xabcdef0000000000000000000000000000000001");
    expect(message).toContain("Nonce: n-1");
    expect(message).toContain("5 minutes at most");
    expect(buildAdminStepUpMessage({ address: " 0xabcdef0000000000000000000000000000000001 ", nonce: "n-1" })).toBe(message);
  });
});
