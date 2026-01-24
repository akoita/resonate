import { Body, Controller, Inject, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { verifyMessage, type PublicClient } from "viem";
import { AuthService } from "./auth.service";
import { AuthNonceService } from "./auth_nonce.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly nonceService: AuthNonceService,
    @Inject("PUBLIC_CLIENT") private readonly publicClient: PublicClient
  ) { }

  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60 } })
  login(@Body() body: { userId: string; role?: string }) {
    return this.authService.issueToken(body.userId, body.role ?? "listener");
  }

  @Post("nonce")
  @Throttle({ default: { limit: 20, ttl: 60 } })
  nonce(@Body() body: { address: string }) {
    return { nonce: this.nonceService.issue(body.address) };
  }

  @Post("verify")
  @Throttle({ default: { limit: 10, ttl: 60 } })
  async verify(
    @Body()
    body: {
      address: string;
      message: string;
      signature: `0x${string}`;
      role?: string;
    }
  ) {
    const ok = await this.publicClient.verifyMessage({
      address: body.address as `0x${string}`,
      message: body.message,
      signature: body.signature,
    });
    if (!ok) {
      return { status: "invalid_signature" };
    }
    const nonceMatch = /Nonce:\s*(.+)$/m.exec(body.message)?.[1] ?? "";
    if (!this.nonceService.consume(body.address, nonceMatch)) {
      return { status: "invalid_nonce" };
    }
    return this.authService.issueTokenForAddress(body.address, body.role ?? "listener");
  }
}
