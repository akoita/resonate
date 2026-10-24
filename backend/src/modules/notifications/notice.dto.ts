import { IsArray, IsOptional, IsString } from "class-validator";

/**
 * Request bodies of the notice send routes (#2362, deferred from #2197).
 *
 * Shape and types only. The value rules (categories, audience, lengths, in-app
 * links, dates, de-duplication) stay in `notice_validation`, which the controller
 * and the service both apply, so a body that gets past this class is still parsed
 * by the same code as before. Presence is not checked here for the same reason: a
 * missing field gets the parser's message.
 */
export class TargetedNoticeDto {
  @IsOptional()
  @IsArray()
  userIds?: unknown[];

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  /** `null` clears it, like an empty string. */
  @IsOptional()
  @IsString()
  link?: string | null;
}

export class BroadcastNoticeDto {
  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  link?: string | null;

  /** ISO dates. The parser rejects a value that is not one. */
  @IsOptional()
  @IsString()
  effectiveAt?: string | null;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;
}
