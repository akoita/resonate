import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import type { MyMixPreferences } from "./agent_my_mix";
import { SHORT_TEXT_MAX_LENGTH, TERM_LIST_MAX_ITEMS, TERM_MAX_LENGTH } from "../shared/request_bounds";

/**
 * Agent config bodies (#2197). Type checks and size bounds; every value rule
 * stays with the controller and the services.
 */
export class CreateAgentConfigDto {
  @IsString()
  @MaxLength(SHORT_TEXT_MAX_LENGTH)
  name!: string;

  @IsArray()
  @ArrayMaxSize(TERM_LIST_MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(TERM_MAX_LENGTH, { each: true })
  vibes!: string[];

  @IsNumber()
  monthlyCapUsd!: number;
}

/**
 * `sessionMode` and `allowExplicit` stay undecorated: the controller answers
 * them with its own `reason` bodies (`invalid_session_mode`, `buy_mode_disabled`,
 * `invalid_allow_explicit`).
 */
export class UpdateAgentConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TERM_LIST_MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(TERM_MAX_LENGTH, { each: true })
  vibes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TERM_LIST_MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(TERM_MAX_LENGTH, { each: true })
  stemTypes?: string[];

  sessionMode?: string;

  @IsOptional()
  @IsNumber()
  monthlyCapUsd?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  allowExplicit?: boolean;
}

/**
 * `trackId` and `action` stay optional here: the controller answers a missing
 * or unknown pair with its own `reason` and `acceptedActions` body.
 */
export class RecordAgentSignalDto {
  @IsOptional()
  @IsString()
  trackId!: string;

  @IsOptional()
  @IsString()
  action!: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Preferences of `POST /agents/config/session`. Only the plainly typed fields
 * are checked. `allowExplicit`, `request`, `requestText`, `artists`, `seed`,
 * `fillSimilar`, `newArtists`, `discovery`, `myMix` and `listeningContext` are
 * sanitized, ignored when malformed or answered with a `reason` by the
 * controller, so they stay undecorated.
 */
export class AgentConfigSessionPreferencesDto {
  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT_MAX_LENGTH)
  mood?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT_MAX_LENGTH)
  energy?: "low" | "medium" | "high";

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TERM_LIST_MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(TERM_MAX_LENGTH, { each: true })
  genres?: string[];

  allowExplicit?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT_MAX_LENGTH)
  licenseType?: "personal" | "remix" | "commercial";

  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT_MAX_LENGTH)
  sessionIntent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT_MAX_LENGTH)
  sessionIntentName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT_MAX_LENGTH)
  queueStyle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT_MAX_LENGTH)
  source?: string;

  request?: unknown;
  requestText?: unknown;
  artists?: unknown;
  seed?: unknown;
  fillSimilar?: unknown;
  newArtists?: unknown;
  discovery?: unknown;
  myMix?: MyMixPreferences | null;
  listeningContext?: unknown;
}

export class StartAgentConfigSessionDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AgentConfigSessionPreferencesDto)
  preferences?: AgentConfigSessionPreferencesDto;
}
