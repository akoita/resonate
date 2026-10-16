import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { minutes } from "../shared/rate_limits";
import { ContactEmailService } from "./contact_email.service";
import { EmailConfig } from "./email_config";
import { EmailDeliveryService, type EmailWebhookEvent } from "./email_delivery.service";
import { EmailTokenDto } from "./email.dto";
import { verifyWebhookSignature } from "./email_tokens";

const MAX_WEBHOOK_EVENTS = 1000;

/**
 * Public email endpoints (#2169): the links in the emails and the provider
 * bounce webhook. None of them needs a session; each is authorised by a token
 * (confirmation, signed unsubscribe) or by the webhook's HMAC signature.
 */
@Controller("email")
export class EmailPublicController {
  constructor(
    private readonly contactEmail: ContactEmailService,
    private readonly delivery: EmailDeliveryService,
    private readonly config: EmailConfig,
  ) {}

  @Post("confirm")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: minutes(1) } })
  confirm(@Body() body: EmailTokenDto) {
    return this.contactEmail.confirm(body.token);
  }

  @Post("unsubscribe")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: minutes(1) } })
  unsubscribe(@Body() body: EmailTokenDto) {
    return this.contactEmail.unsubscribe(body.token);
  }

  /** RFC 8058 one-click: the mail client POSTs here with `List-Unsubscribe=One-Click`; the body is ignored. */
  @Post("unsubscribe/one-click")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: minutes(1) } })
  oneClick(@Query("token") token: unknown) {
    return this.contactEmail.unsubscribe(token);
  }

  /**
   * Provider-neutral bounce and complaint events. The signature covers the raw
   * request body (`X-Resonate-Signature: sha256=<hex HMAC>`), so `rawBody` must
   * be enabled when the app is created.
   */
  @Post("webhook")
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: minutes(1) } })
  async webhook(@Req() req: any) {
    const secret = this.config.webhookSecret;
    if (!secret) {
      throw new ServiceUnavailableException({ code: "webhook_unavailable", message: "Webhook is not configured" });
    }
    const raw: Buffer | undefined = req.rawBody;
    if (!raw || !verifyWebhookSignature(raw, req.headers["x-resonate-signature"], secret)) {
      throw new UnauthorizedException({ code: "invalid_signature", message: "Invalid signature" });
    }
    return this.delivery.handleProviderEvents(parseWebhookEvents(req.body));
  }
}

export function parseWebhookEvents(body: unknown): EmailWebhookEvent[] {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || events.length > MAX_WEBHOOK_EVENTS) {
    throw new BadRequestException(`events must be an array of at most ${MAX_WEBHOOK_EVENTS} entries`);
  }
  return events.map((event) => {
    const e = (event ?? {}) as Record<string, unknown>;
    if (e.type !== "bounce" && e.type !== "complaint") {
      throw new BadRequestException("each event type must be bounce or complaint");
    }
    if (typeof e.email !== "string" || !e.email || e.email.length > 254) {
      throw new BadRequestException("each event needs an email");
    }
    if (e.bounceType !== undefined && e.bounceType !== "hard" && e.bounceType !== "soft") {
      throw new BadRequestException("bounceType must be hard or soft");
    }
    return { type: e.type, email: e.email, bounceType: e.bounceType } as EmailWebhookEvent;
  });
}
