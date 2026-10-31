import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { BILLING_INTERVALS, type BillingInterval } from "./billing_config";
import { BILLING_CURRENCIES, type BillingCurrency } from "./billing_currency";

/**
 * `POST /billing/subscription/checkout` (#2407). The person picks monthly or
 * yearly, and explicitly asks for the subscription to start now after reading
 * the wording `GET /billing/subscription` served (`textVersion`). `currency`
 * is the one the price was shown in (#2496; USD when absent).
 */
export class StartSubscriptionCheckoutDto {
  @IsIn(BILLING_INTERVALS)
  interval!: BillingInterval;

  @IsOptional()
  @IsIn(BILLING_CURRENCIES)
  currency?: BillingCurrency;

  /** The explicit tick: must be true; nothing is pre-selected. */
  @IsBoolean()
  acknowledgedImmediateStart!: boolean;

  @IsString()
  @MaxLength(64)
  textVersion!: string;
}
