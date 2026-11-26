import { Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { seconds } from "../shared/rate_limits";
import { EventBus } from "../shared/event_bus";
import { RequireSurface } from "../product_surfaces/product_surface.guard";
import { SignupFaucetService } from "./signup_faucet.service";

/**
 * Welcome test money for newcomers (staging only: the faucet refuses any
 * non-test network). The Wallet page reads the status and offers a
 * "Get my test money" button when a welcome leg has not arrived yet.
 */
@Controller("welcome-funds")
@RequireSurface("wallet")
@UseGuards(AuthGuard("jwt"))
export class WelcomeFundsController {
  constructor(
    private readonly faucet: SignupFaucetService,
    private readonly eventBus: EventBus,
  ) {}

  @Get()
  status(@Req() req: any) {
    return this.faucet.getWelcomeFundsStatus(req.user.userId);
  }

  @Post()
  @Throttle({ default: { limit: 3, ttl: seconds(60) } })
  async claim(@Req() req: any) {
    const result = await this.faucet.claimWelcomeFunds(req.user.userId);
    if (result.status === "sent") {
      this.eventBus.publish({
        eventName: "wallet.faucet_requested",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        userId: req.user.userId,
        chainId: result.chainId,
        amountEth: result.amountEth,
        amountUsdc: result.amountUsdc,
        status: "sent",
      });
    }
    return {
      result: result.status === "sent"
        ? { status: "sent", amountEth: result.amountEth ?? null, amountUsdc: result.amountUsdc ?? null }
        // A failed send's raw error can name the RPC endpoint; never echo it.
        : { status: result.status, reason: result.status === "failed" ? "send_failed" : result.reason },
      welcome: await this.faucet.getWelcomeFundsStatus(req.user.userId),
    };
  }
}
