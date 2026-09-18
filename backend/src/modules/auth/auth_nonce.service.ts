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

  /**
   * The outstanding nonce for a key, without consuming it.
   *
   * Exists so a caller that must *rebuild* the challenge text server-side can
   * do it from server state alone (#1771 slice 3b): the account-closure
   * step-up verifies a signature over a message it constructs itself, and
   * would otherwise have to take the nonce back from the client to know which
   * message to construct. Reading is not accepting — every caller still has to
   * {@link consume} the nonce, which is what makes it single-use.
   *
   * Never expose this over HTTP. A route that returned the outstanding nonce
   * for an arbitrary address would hand an attacker half of every challenge.
   */
  peek(address: string) {
    return this.nonces.get(address.toLowerCase());
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
