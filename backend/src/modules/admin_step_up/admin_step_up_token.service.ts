import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";

/** The window a step-up proof is valid for, and the most any deployment may set (#2173). */
export const ADMIN_STEP_UP_MAX_TTL_SECONDS = 300;
export const ADMIN_STEP_UP_MIN_TTL_SECONDS = 30;
/** How long an issued challenge may be answered. */
export const ADMIN_STEP_UP_CHALLENGE_TTL_SECONDS = 120;

type TokenKind = "admin_step_up_proof" | "admin_step_up_challenge";

interface TokenPayload {
  typ: TokenKind;
  /** The admin's user id; a proof only ever works for the person who earned it. */
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  /** Challenge only: the address the person must sign with, and the nonce in the words. */
  addr?: string;
  nonce?: string;
}

export type ProofCheck =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: "missing" | "invalid" | "expired" };

export type ChallengeCheck =
  | { ok: true; address: string; nonce: string; jti: string; expiresAt: number }
  | { ok: false };

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/**
 * Issues and checks the two short-lived signed tokens of the admin step-up.
 *
 * Why a signed token and not a server-side record: nothing about the proof
 * needs to outlive five minutes or be revoked individually, a stateless token
 * works on every instance of a scaled-out backend without a shared store, and
 * it adds no table to the personal-data surface. Each verification is recorded
 * in the durable admin audit log, which is the revocable, queryable record.
 *
 * Why not a JWT: the session `JwtStrategy` accepts any token signed with the
 * session secret that has a `sub`, so a step-up token minted by the same
 * `JwtService` could be replayed as a bearer session. These tokens use their own
 * format, signed with a key derived from the session secret under a different
 * label, and are never accepted by passport. A proof is also bound to the admin's
 * user id, carries its own purpose (`typ`), and is never used to extend the
 * session JWT.
 */
@Injectable()
export class AdminStepUpTokenService {
  private key: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Proof lifetime in seconds: `ADMIN_STEP_UP_TTL_SECONDS` clamped to 30-300, default 300. */
  get ttlSeconds(): number {
    const raw = Number(this.config.get<string>("ADMIN_STEP_UP_TTL_SECONDS"));
    if (!Number.isFinite(raw) || raw <= 0) return ADMIN_STEP_UP_MAX_TTL_SECONDS;
    return Math.min(
      ADMIN_STEP_UP_MAX_TTL_SECONDS,
      Math.max(ADMIN_STEP_UP_MIN_TTL_SECONDS, Math.floor(raw)),
    );
  }

  issueProof(userId: string, now: number = Date.now()): { proof: string; expiresAt: number } {
    const iat = Math.floor(now / 1000);
    const exp = iat + this.ttlSeconds;
    const proof = this.sign({ typ: "admin_step_up_proof", sub: userId, iat, exp, jti: randomUUID() });
    return { proof, expiresAt: exp * 1000 };
  }

  checkProof(token: unknown, userId: string, now: number = Date.now()): ProofCheck {
    if (typeof token !== "string" || !token.trim()) return { ok: false, reason: "missing" };
    const payload = this.open(token.trim(), "admin_step_up_proof");
    if (!payload || payload.sub !== userId) return { ok: false, reason: "invalid" };
    // The ceiling is enforced on read too, so a token minted under a longer
    // configured window can never outlive the current one.
    const ceiling = payload.iat + this.ttlSeconds;
    if (Math.floor(now / 1000) >= Math.min(payload.exp, ceiling)) return { ok: false, reason: "expired" };
    return { ok: true, expiresAt: Math.min(payload.exp, ceiling) * 1000 };
  }

  issueChallenge(
    input: { userId: string; address: string },
    now: number = Date.now(),
  ): { token: string; nonce: string; expiresAt: number } {
    const iat = Math.floor(now / 1000);
    const exp = iat + ADMIN_STEP_UP_CHALLENGE_TTL_SECONDS;
    const nonce = randomUUID();
    const token = this.sign({
      typ: "admin_step_up_challenge",
      sub: input.userId,
      iat,
      exp,
      jti: randomUUID(),
      addr: input.address.toLowerCase(),
      nonce,
    });
    return { token, nonce, expiresAt: exp * 1000 };
  }

  checkChallenge(token: unknown, userId: string, now: number = Date.now()): ChallengeCheck {
    if (typeof token !== "string") return { ok: false };
    const payload = this.open(token.trim(), "admin_step_up_challenge");
    if (!payload || payload.sub !== userId || !payload.addr || !payload.nonce) return { ok: false };
    if (Math.floor(now / 1000) >= payload.exp) return { ok: false };
    return {
      ok: true,
      address: payload.addr,
      nonce: payload.nonce,
      jti: payload.jti,
      expiresAt: payload.exp * 1000,
    };
  }

  // ============ Token format: <payload>.<mac>, both base64url ============

  private signingKey(): Buffer {
    if (!this.key) {
      const configured = this.config.get<string>("JWT_SECRET");
      // Same rule as the session JWT (auth.module.ts): no production fallback secret.
      if (!configured && process.env.NODE_ENV === "production") {
        throw new Error("JWT_SECRET must be set in production");
      }
      const secret = configured || "dev-secret";
      this.key = createHmac("sha256", secret).update("resonate:admin-step-up:v1").digest();
    }
    return this.key;
  }

  private mac(body: string): Buffer {
    return createHmac("sha256", this.signingKey()).update(body).digest();
  }

  private sign(payload: TokenPayload): string {
    const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
    return `${body}.${b64url(this.mac(body))}`;
  }

  private open(token: string, kind: TokenKind): TokenPayload | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, mac] = parts;
    const expected = this.mac(body);
    let given: Buffer;
    try {
      given = Buffer.from(mac, "base64url");
    } catch {
      return null;
    }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
      if (
        payload?.typ !== kind ||
        typeof payload.sub !== "string" ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" ||
        typeof payload.jti !== "string"
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }
}
