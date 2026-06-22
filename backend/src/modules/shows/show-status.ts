import { BadRequestException } from "@nestjs/common";
import type {
  ShowArtistAuthorityStatus,
  ShowCampaignBeneficiaryType,
  ShowCampaignEventType,
  ShowCampaignLevel,
  ShowCampaignReleasePolicy,
  ShowCampaignStatus,
  ShowPledgeConfirmationStatus,
  ShowPledgeStatus,
} from "@prisma/client";

export const SHOW_CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "funded",
  "booking_confirmed",
  "deposit_released",
  "fulfilled",
  "released",
  "cancelled",
  "refund_available",
  "refunded",
] as const satisfies readonly ShowCampaignStatus[];

export const SHOW_CAMPAIGN_LEVELS = [
  "signal",
  "provisional_campaign",
  "active_escrow_campaign",
] as const satisfies readonly ShowCampaignLevel[];

export const SHOW_ARTIST_AUTHORITY_STATUSES = [
  "none",
  "human_verified",
  "artist_acknowledged",
  "artist_authorized",
  "trusted_source_authorized",
  "rejected",
  "revoked",
  "expired",
] as const satisfies readonly ShowArtistAuthorityStatus[];

export const SHOW_CAMPAIGN_BENEFICIARY_TYPES = [
  "wallet",
  "split_contract",
  "multisig",
] as const satisfies readonly ShowCampaignBeneficiaryType[];

export const SHOW_CAMPAIGN_RELEASE_POLICIES = [
  "refund_only_until_booking",
  "staged_release",
  "manual_ops_release",
] as const satisfies readonly ShowCampaignReleasePolicy[];

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
  "campaign_signal_created",
  "campaign_created",
  "campaign_updated",
  "campaign_activated",
  "artist_authority_requested",
  "artist_authority_approved",
  "artist_authority_rejected",
  "artist_authority_revoked",
  "artist_authority_expired",
  "campaign_escalated_to_escrow",
  "campaign_funded",
  "booking_confirmed",
  "booking_evidence_submitted",
  "deposit_released",
  "fulfillment_confirmed",
  "refund_available",
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
  "dispute_initiated",
  "dispute_resolved",
] as const satisfies readonly ShowCampaignEventType[];

export function assertShowCampaignStatus(value: string): ShowCampaignStatus {
  return assertEnumValue(value, SHOW_CAMPAIGN_STATUSES, "campaign status");
}

export function assertShowCampaignLevel(value: string): ShowCampaignLevel {
  return assertEnumValue(value, SHOW_CAMPAIGN_LEVELS, "campaign level");
}

export function assertShowArtistAuthorityStatus(value: string): ShowArtistAuthorityStatus {
  return assertEnumValue(value, SHOW_ARTIST_AUTHORITY_STATUSES, "artist authority status");
}

export function assertShowCampaignBeneficiaryType(value: string): ShowCampaignBeneficiaryType {
  return assertEnumValue(value, SHOW_CAMPAIGN_BENEFICIARY_TYPES, "campaign beneficiary type");
}

export function assertShowCampaignReleasePolicy(value: string): ShowCampaignReleasePolicy {
  return assertEnumValue(value, SHOW_CAMPAIGN_RELEASE_POLICIES, "campaign release policy");
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
