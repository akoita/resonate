import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import type { MyMixPreferences } from "./agent_my_mix";

/**
 * Agent config bodies (#2197). Type checks only; every value rule stays with
 * the controller and the services.
 */
export class CreateAgentConfigDto {
  @IsString()
  name!: string;

  @IsArray()
  @IsString({ each: true })
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
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vibes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
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
  mood?: string;

  @IsOptional()
  @IsString()
  energy?: "low" | "medium" | "high";

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];

  allowExplicit?: boolean;

  @IsOptional()
  @IsString()
  licenseType?: "personal" | "remix" | "commercial";

  @IsOptional()
  @IsString()
  sessionIntent?: string;

  @IsOptional()
  @IsString()
  sessionIntentName?: string;

  @IsOptional()
  @IsString()
  queueStyle?: string;

  @IsOptional()
  @IsString()
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
