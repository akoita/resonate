import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import {
  SESSION_SEED_ID_MAX_LENGTH,
  SESSION_SEED_KINDS,
  SESSION_SEED_LABEL_MAX_LENGTH,
  type SessionSeedKind,
} from "../agents/agent_session_seed";
import type { AgentSessionRequest } from "../agents/agent_session_request";
import type { MyMixPreferences } from "../agents/agent_my_mix";

/**
 * Session bodies (#1890). The global pipe keeps unknown fields and does not
 * coerce, so these only reject wrong types: the services keep their own value
 * checks. `request` and `myMix` are left undecorated because the agent runtime
 * sanitizes and validates them.
 */
/**
 * The seed of a seeded AI DJ session (#2244). The server looks the subject up,
 * checks the caller may use it (own or public playlist) and replaces `label`
 * with the catalog's own, so the label sent is only a display fallback.
 */
export class SessionSeedDto {
  @IsIn(SESSION_SEED_KINDS)
  kind!: SessionSeedKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(SESSION_SEED_ID_MAX_LENGTH)
  id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(SESSION_SEED_LABEL_MAX_LENGTH)
  label?: string;
}

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

  /**
   * "More like this" (#2243): a track already picked in this session whose
   * stored-embedding neighbours steer this one pick. Used by `agent/next`
   * only, never remembered, checked by the service.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  seedTrackId?: string;

  /** Listening filters from the listener's own words (#2037); sanitized by the service. */
  request?: AgentSessionRequest;

  /** The listener's sentence (#2241): joins this session's semantic query only; never stored or logged. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  requestText?: string;

  /** Catalog artists the sentence named (#2241); the service bounds the list. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  artists?: string[];

  /**
   * What the session started from (#2244): a track, an artist or a playlist.
   * Kept for the whole live session (unlike `seedTrackId`); `null` clears it.
   * The service resolves it and refuses a playlist the caller may not use.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SessionSeedDto)
  seed?: SessionSeedDto | null;

  /**
   * "Fill with similar sounds" (#2316): allow marked off-request tracks to fill
   * a batch the catalog cannot fill with matches. Off unless `true`.
   */
  @IsOptional()
  @IsBoolean()
  fillSimilar?: boolean;

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
