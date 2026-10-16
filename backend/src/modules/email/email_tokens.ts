import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/** A confirmation link is good for 24 hours and works once. */
export const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A fresh confirmation token. Only `hash` is stored; `raw` goes into the email. */
export function newConfirmToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256Hex(raw) };
}

function sign(payloadPart: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

/**
 * Stateless unsubscribe token (#2169): HMAC-SHA256 over `{ userId, category, v: 1 }`.
 * `<base64url payload>.<base64url mac>`. Nothing is stored; the secret is
 * `EMAIL_LINK_SIGNING_SECRET`. The token never carries the email address.
 */
export function signUnsubscribeToken(userId: string, category: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, category, v: 1 })).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

/** The userId and category in a valid token, or `null` for anything tampered, malformed or unsigned. */
export function verifyUnsubscribeToken(
  token: unknown,
  secret: string,
): { userId: string; category: string } | null {
  if (typeof token !== "string" || !secret || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payloadPart, macPart] = parts;
  const expected = sign(payloadPart, secret);
  let given: Buffer;
  try {
    given = Buffer.from(macPart, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      userId?: unknown;
      category?: unknown;
      v?: unknown;
    };
    if (payload.v !== 1 || typeof payload.userId !== "string" || typeof payload.category !== "string") return null;
    return { userId: payload.userId, category: payload.category };
  } catch {
    return null;
  }
}

/** Constant-time check of a webhook body signature: `sha256=<hex HMAC of the raw body>`. */
export function verifyWebhookSignature(rawBody: Buffer, header: unknown, secret: string): boolean {
  if (typeof header !== "string" || !secret) return false;
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(match[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
