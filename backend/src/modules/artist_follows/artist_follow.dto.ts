import { IsObject, IsOptional, IsString, Matches, MaxLength } from "class-validator";

/** Identifier-shaped tokens keep prose out of the analytics payload. */
export const FOLLOW_CONTEXT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const FOLLOW_SOURCE_PATTERN = /^[a-z][a-z0-9_.:-]{0,63}$/;

/**
 * Optional body of `PUT /artists/:artistId/follow` (#1968).
 *
 * `releaseId` / `trackId` say which release the listener was looking at when
 * they followed. They are only recorded when they belong to the artist's own
 * catalog; anything else is dropped silently, never an error, so a stale page
 * can still follow. `geo` is the listener's user-declared city, handled exactly
 * like the `geo` on the browser telemetry routes.
 */
export class FollowArtistDto {
  @IsOptional()
  @IsString()
  @Matches(FOLLOW_CONTEXT_ID_PATTERN)
  releaseId?: string;

  @IsOptional()
  @IsString()
  @Matches(FOLLOW_CONTEXT_ID_PATTERN)
  trackId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(FOLLOW_SOURCE_PATTERN)
  source?: string;

  @IsOptional()
  @IsObject()
  geo?: Record<string, unknown>;
}
