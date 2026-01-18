import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

interface SessionKeyRecord {
  token: string;
  userId: string;
  scope: string;
  expiresAt: number;
}

@Injectable()
export class SessionKeyService {
  private keys = new Map<string, SessionKeyRecord>();

  issue(input: { userId: string; scope: string; ttlSeconds: number }) {
    const token = `sk_${randomUUID()}`;
    const record: SessionKeyRecord = {
      token,
      userId: input.userId,
      scope: input.scope,
      expiresAt: Date.now() + input.ttlSeconds * 1000,
    };
    this.keys.set(token, record);
    return record;
  }

  validate(token: string, scope: string) {
    const record = this.keys.get(token);
    if (!record) {
      return { valid: false, reason: "not_found" };
    }
    if (record.expiresAt < Date.now()) {
      return { valid: false, reason: "expired" };
    }
    if (record.scope !== scope) {
      return { valid: false, reason: "scope_mismatch" };
    }
    return { valid: true, userId: record.userId };
  }
}
