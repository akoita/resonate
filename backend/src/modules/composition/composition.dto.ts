import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { MAX_COVER_NOTE, MAX_PUBLISHER, MAX_WRITERS } from "./composition";

/**
 * Body of `PUT /catalog/releases/:releaseId/tracks/:trackId/composition`
 * (#2669). The global pipe checks the outer shape; each writer and the share
 * and code rules are checked by `normalizeCompositionInput`.
 */
export class SaveCompositionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_WRITERS)
  writers?: unknown[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PUBLISHER)
  publisher?: string | null;

  @IsOptional()
  @IsBoolean()
  selfPublished?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  iswc?: string | null;

  @IsOptional()
  @IsBoolean()
  coverOrSamples?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_COVER_NOTE)
  coverNote?: string | null;
}
