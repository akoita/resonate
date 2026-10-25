import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { minutes } from "../shared/rate_limits";
import { DeliverHeldCreditsDto, StartCreditCheckoutDto } from "./credit_topup.dto";
import { CreditTopUpService } from "./credit_topup.service";

/**
 * Buying generation-credit packs (#1422, Stripe test mode). The checkout
 * answers 503 `billing_unavailable` when Stripe or a pack price is not
 * configured; the state route always answers, with `available: false`, so the
 * app can say so. Releasing a held purchase needs no Stripe call.
 */
@Controller("billing/credits")
@UseGuards(AuthGuard("jwt"))
export class CreditTopUpController {
  constructor(private readonly topUps: CreditTopUpService) {}

  @Get()
  state(@Req() req: any) {
    return this.topUps.getState(req.user.userId);
  }

  @Post("checkout")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  checkout(@Req() req: any, @Body() body: StartCreditCheckoutDto) {
    return this.topUps.startCheckout(req.user.userId, body);
  }

  @Post("purchases/:id/deliver-now")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  deliverNow(@Req() req: any, @Param("id") id: string, @Body() body: DeliverHeldCreditsDto) {
    return this.topUps.deliverHeldNow(req.user.userId, id, body);
  }
}
