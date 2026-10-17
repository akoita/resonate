import { BadGatewayException, BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { writeStructuredLog } from "../shared/structured_logging";
import { EmailConfig } from "./email_config";
import { EmailDeliveryService } from "./email_delivery.service";
import { isAllowedSubscribeUrl, mapSnsMessage, type SnsEnvelope } from "./email_sns";

const CONFIRM_TIMEOUT_MS = 5_000;

/**
 * Bounce and complaint events from an SNS-compatible topic (#2177). The
 * controller has already checked the path token; this checks the topic,
 * confirms the subscription through an allowlisted host only, and hands mapped
 * events to the same hard-bounce and complaint path as `POST /email/webhook`.
 */
@Injectable()
export class EmailSnsService {
  /** Replaced in tests; the confirmation request never follows redirects. */
  fetchFn: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    private readonly config: EmailConfig,
    private readonly delivery: EmailDeliveryService,
  ) {}

  async handle(envelope: SnsEnvelope) {
    if (envelope.topicArn !== this.config.snsTopicArn) {
      throw new ForbiddenException({ code: "topic_not_allowed", message: "This topic is not accepted" });
    }
    switch (envelope.type) {
      case "SubscriptionConfirmation":
        return this.confirm(envelope.subscribeUrl);
      case "UnsubscribeConfirmation":
        writeStructuredLog({
          level: "warn",
          event: "email.sns_unsubscribed",
          message: "The SNS topic reported that this endpoint was unsubscribed",
        });
        return { status: "ignored" };
      case "Notification":
        return this.notify(envelope.message);
    }
  }

  private async confirm(subscribeUrl: string) {
    if (!isAllowedSubscribeUrl(subscribeUrl, this.config.snsConfirmHostSuffixes, this.config.snsTopicArn)) {
      writeStructuredLog({
        level: "warn",
        event: "email.sns_confirm_refused",
        message: "Refused a subscription confirmation URL outside EMAIL_SNS_CONFIRM_HOST_SUFFIXES",
      });
      throw new BadRequestException({ code: "subscribe_url_not_allowed", message: "Subscription URL is not allowed" });
    }
    let status: number;
    try {
      const response = await this.fetchFn(subscribeUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS),
      });
      status = response.status;
    } catch (error) {
      writeStructuredLog({
        level: "error",
        event: "email.sns_confirm_failed",
        message: "Could not reach the subscription confirmation URL",
        errorClass: error instanceof Error ? error.name : "unknown",
      });
      throw new BadGatewayException({ code: "subscription_not_confirmed", message: "Subscription not confirmed" });
    }
    if (status < 200 || status >= 300) {
      writeStructuredLog({
        level: "error",
        event: "email.sns_confirm_failed",
        message: "The subscription confirmation URL did not answer 2xx",
        status,
      });
      throw new BadGatewayException({ code: "subscription_not_confirmed", message: "Subscription not confirmed" });
    }
    writeStructuredLog({ level: "info", event: "email.sns_confirmed", message: "Confirmed the SNS subscription" });
    return { status: "confirmed" };
  }

  private async notify(message: string) {
    const mapped = mapSnsMessage(this.config.snsEventFormat, message);
    if (!mapped) {
      throw new BadRequestException({ code: "invalid_message", message: "Message is not a supported provider event" });
    }
    const result = await this.delivery.handleProviderEvents(mapped.events);
    return { ...result, received: result.received + mapped.ignored, ignored: result.ignored + mapped.ignored };
  }
}
