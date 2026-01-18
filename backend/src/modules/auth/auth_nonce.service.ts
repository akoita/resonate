import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

@Injectable()
export class AuthNonceService {
  private nonces = new Map<string, string>();

  issue(address: string) {
    const nonce = randomUUID();
    this.nonces.set(address.toLowerCase(), nonce);
    return nonce;
  }

  consume(address: string, nonce: string) {
    const key = address.toLowerCase();
    const existing = this.nonces.get(key);
    if (!existing || existing !== nonce) {
      return false;
    }
    this.nonces.delete(key);
    return true;
  }
}
