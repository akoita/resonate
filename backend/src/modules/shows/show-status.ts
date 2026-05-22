import { BadRequestException } from "@nestjs/common";
import type {
  ShowCampaignEventType,
  ShowCampaignStatus,
  ShowPledgeConfirmationStatus,
  ShowPledgeStatus,
} from "@prisma/client";

export const SHOW_CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "funded",
  "booking_confirmed",
  "released",
  "cancelled",
  "refunded",
] as const satisfies readonly ShowCampaignStatus[];

export const SHOW_PLEDGE_STATUSES = [
  "intent_created",
  "submitted",
  "confirmed",
  "refund_available",
  "refunded",
  "released",
  "failed",
] as const satisfies readonly ShowPledgeStatus[];

export const SHOW_PLEDGE_CONFIRMATION_STATUSES = [
  "not_submitted",
  "pending",
  "confirmed",
  "failed",
] as const satisfies readonly ShowPledgeConfirmationStatus[];

export const SHOW_CAMPAIGN_EVENT_TYPES = [
  "campaign_created",
  "campaign_updated",
  "campaign_activated",
  "campaign_funded",
  "booking_confirmed",
  "campaign_released",
  "campaign_cancelled",
  "campaign_refunded",
  "pledge_intent_created",
  "pledge_submitted",
  "pledge_confirmed",
  "pledge_refund_available",
  "pledge_refunded",
  "pledge_released",
  "pledge_failed",
  "operator_note",
] as const satisfies readonly ShowCampaignEventType[];

export function assertShowCampaignStatus(value: string): ShowCampaignStatus {
  return assertEnumValue(value, SHOW_CAMPAIGN_STATUSES, "campaign status");
}

export function assertShowPledgeStatus(value: string): ShowPledgeStatus {
  return assertEnumValue(value, SHOW_PLEDGE_STATUSES, "pledge status");
}

export function assertShowPledgeConfirmationStatus(value: string): ShowPledgeConfirmationStatus {
  return assertEnumValue(value, SHOW_PLEDGE_CONFIRMATION_STATUSES, "pledge confirmation status");
}

export function assertShowCampaignEventType(value: string): ShowCampaignEventType {
  return assertEnumValue(value, SHOW_CAMPAIGN_EVENT_TYPES, "campaign event type");
}

function assertEnumValue<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new BadRequestException(`Invalid ${field}`);
}
