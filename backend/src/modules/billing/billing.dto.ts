import { IsBoolean, IsIn, IsString, MaxLength } from "class-validator";
import { BILLING_INTERVALS, type BillingInterval } from "./billing_config";

/**
 * `POST /billing/subscription/checkout` (#2407). The person picks monthly or
 * yearly, and explicitly asks for the subscription to start now after reading
 * the wording `GET /billing/subscription` served (`textVersion`).
 */
export class StartSubscriptionCheckoutDto {
  @IsIn(BILLING_INTERVALS)
  interval!: BillingInterval;

  /** The explicit tick: must be true; nothing is pre-selected. */
  @IsBoolean()
  acknowledgedImmediateStart!: boolean;

  @IsString()
  @MaxLength(64)
  textVersion!: string;
}
