import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { minutes } from "../shared/rate_limits";
import { StartSubscriptionCheckoutDto } from "./billing.dto";
import { BillingService } from "./billing.service";

/**
 * The signed-in person's Artist Pro subscription (#2407). Checkout and the
 * Portal answer 503 `billing_unavailable` when Stripe is not configured; the
 * state route always answers, with `available: false`, so the app can say so.
 */
@Controller("billing")
@UseGuards(AuthGuard("jwt"))
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("subscription")
  state(@Req() req: any) {
    return this.billing.getState(req.user.userId);
  }

  @Post("subscription/checkout")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  checkout(@Req() req: any, @Body() body: StartSubscriptionCheckoutDto) {
    return this.billing.startCheckout(req.user.userId, body);
  }

  @Post("portal")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: minutes(1) } })
  portal(@Req() req: any) {
    return this.billing.openPortal(req.user.userId);
  }
}
