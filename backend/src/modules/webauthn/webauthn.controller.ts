import { Controller, Post, Body, Logger, Headers } from "@nestjs/common";
import { WebAuthnService } from "./webauthn.service";

/**
 * Self-hosted WebAuthn/Passkey server endpoints.
 *
 * These implement the same API contract that ZeroDev's hosted passkey server
 * uses, so the @zerodev/webauthn-key SDK works with no changes.
 *
 * Endpoints:
 *   POST /api/passkeys/register/options   → generate registration challenge
 *   POST /api/passkeys/register/verify    → verify attestation + store credential
 *   POST /api/passkeys/login/options      → generate authentication challenge
 *   POST /api/passkeys/login/verify       → verify assertion + return pubkey
 */
@Controller("api/passkeys")
export class WebAuthnController {
  private readonly logger = new Logger(WebAuthnController.name);

  constructor(private readonly webAuthnService: WebAuthnService) {}

  @Post("register/options")
  async registerOptions(@Body() body: { username?: string; rpID?: string }) {
    const username = body.username || "Resonate";
    this.logger.log(`Register options requested for "${username}"`);
    return this.webAuthnService.getRegistrationOptions(username, body.rpID);
  }

  @Post("register/verify")
  async registerVerify(
    @Headers("origin") origin: string | undefined,
    @Body() body: { userId: string; username?: string; cred: any; rpID?: string },
  ) {
    this.logger.log(`Register verify for userId: ${body.userId}`);
    return this.webAuthnService.verifyRegistration(
      body.userId,
      body.username || "Resonate",
      body.cred,
      body.rpID,
      origin,
    );
  }

  @Post("login/options")
  async loginOptions(@Body() body: { rpID?: string }) {
    this.logger.log("Login options requested");
    return this.webAuthnService.getAuthenticationOptions(body.rpID);
  }

  @Post("login/verify")
  async loginVerify(
    @Headers("origin") origin: string | undefined,
    @Body() body: { cred: any; rpID?: string },
  ) {
    this.logger.log("Login verify requested");
    return this.webAuthnService.verifyAuthentication(
      body.cred,
      body.rpID,
      origin,
    );
  }
}
