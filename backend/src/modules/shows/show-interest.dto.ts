import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/** How a campaign runs (#2668). */
export const SHOW_CAMPAIGN_MODES = ["pledge", "interest"] as const;
export type ShowCampaignMode = (typeof SHOW_CAMPAIGN_MODES)[number];

export const SHOW_INTEREST_CITY_MAX = 80;

/** Body of `PUT /shows/campaigns/:id/interest`. */
export class DeclareShowInterestDto {
  /** The city the fan chose; never inferred. */
  @IsOptional()
  @IsString()
  @MaxLength(SHOW_INTEREST_CITY_MAX)
  city?: string;

  /** Tell me when tickets or pledges open. */
  @IsOptional()
  @IsBoolean()
  notifyWhenOpen?: boolean;
}

/** Body of `POST /shows/campaigns/:id/mode`. */
export class SetShowCampaignModeDto {
  @IsIn(SHOW_CAMPAIGN_MODES)
  mode!: ShowCampaignMode;
}
