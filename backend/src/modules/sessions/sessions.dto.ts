import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import type { AgentSessionRequest } from "../agents/agent_session_request";
import type { MyMixPreferences } from "../agents/agent_my_mix";

/**
 * Session bodies (#1890). The global pipe keeps unknown fields and does not
 * coerce, so these only reject wrong types: the services keep their own value
 * checks. `request` and `myMix` are left undecorated because the agent runtime
 * sanitizes and validates them.
 */
export class SessionPreferencesDto {
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

  @IsOptional()
  @IsBoolean()
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

  /** Listening filters from the listener's own words (#2037); sanitized by the service. */
  request?: AgentSessionRequest;

  /** Session-only taste lanes (#2065); validated by the service. `null` clears them. */
  myMix?: MyMixPreferences | null;
}

/** POST /sessions/start. `userId` in the body is ignored: the caller is the owner. */
export class StartSessionDto {
  /** Ignored: the controller always uses the authenticated caller. */
  userId?: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  budgetCapUsd!: number;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SessionPreferencesDto)
  preferences?: SessionPreferencesDto;
}

/** POST /sessions/stop. */
export class StopSessionDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;
}

/** POST /sessions/play. The service re-checks the price before any spend. */
export class PlayTrackDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  trackId!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  priceUsd!: number;
}

/** POST /sessions/agent/next. */
export class AgentNextDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SessionPreferencesDto)
  preferences?: SessionPreferencesDto;
}
