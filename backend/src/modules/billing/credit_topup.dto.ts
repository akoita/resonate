import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { BILLING_CURRENCIES, type BillingCurrency } from "./billing_currency";
import { CREDIT_PACK_IDS, type CreditPackId } from "./credit_packs";

export const CREDIT_DELIVERY_CHOICES = ["deliver_now", "wait"] as const;
export type CreditDeliveryChoice = (typeof CREDIT_DELIVERY_CHOICES)[number];

/**
 * The buyer's `credit_topup` delivery choice (#1776), made before paying, with
 * the wording version `GET /billing/credits` served. Nothing is pre-selected:
 * the choice is required. "Deliver now" needs `acknowledgedWaiver: true`;
 * "wait" needs it false. The service re-checks both.
 */
export class CreditCheckoutConsentDto {
  @IsIn(CREDIT_DELIVERY_CHOICES)
  choice!: CreditDeliveryChoice;

  @IsBoolean()
  acknowledgedWaiver!: boolean;

  @IsString()
  @MaxLength(64)
  textVersion!: string;
}

/**
 * `POST /billing/credits/checkout` (#1422). The client names a pack and the
 * currency the buyer was shown (#2496; USD when absent); the price and the
 * credits come from the server catalogue, never from the request.
 */
export class StartCreditCheckoutDto {
  @IsIn(CREDIT_PACK_IDS)
  packId!: CreditPackId;

  @IsOptional()
  @IsIn(BILLING_CURRENCIES)
  currency?: BillingCurrency;

  @IsObject()
  @ValidateNested()
  @Type(() => CreditCheckoutConsentDto)
  consent!: CreditCheckoutConsentDto;
}

/**
 * `POST /billing/credits/purchases/:id/deliver-now` (#1422): release a held
 * purchase now. The explicit acknowledgement that this ends the right to
 * withdraw must be true.
 */
export class DeliverHeldCreditsDto {
  @IsBoolean()
  acknowledgedWaiver!: boolean;

  @IsString()
  @MaxLength(64)
  textVersion!: string;
}
