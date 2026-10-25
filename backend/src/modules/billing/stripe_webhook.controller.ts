import { Controller, HttpCode, Post, Req, ServiceUnavailableException } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { minutes } from "../shared/rate_limits";
import { StripeWebhookService } from "./stripe_webhook.service";

/**
 * Stripe's webhook endpoint (#2407). Public (Stripe sends no session) but
 * authorised by the `Stripe-Signature` header over the raw request body, so
 * `rawBody` must be enabled when the app is created (`main.ts`). It reads the
 * raw body itself and declares no `@Body()`: a DTO would parse the payload
 * before the signature is checked (`docs/engineering/request-body-validation.md`).
 * Throttled per caller address; the payload is never logged.
 */
@Controller("billing/stripe")
export class StripeWebhookController {
  constructor(private readonly webhooks: StripeWebhookService) {}

  @Post("webhook")
  @HttpCode(200)
  @Throttle({ default: { limit: 300, ttl: minutes(1) } })
  async webhook(@Req() req: any) {
    if (!this.webhooks.isAvailable()) {
      throw new ServiceUnavailableException({ code: "billing_unavailable", message: "Billing is not configured" });
    }
    const event = this.webhooks.verify(req.rawBody, req.headers?.["stripe-signature"]);
    return this.webhooks.handle(event);
  }
}
