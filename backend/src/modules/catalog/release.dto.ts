import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import type { AiDisclosureInput } from "./ai-disclosure.policy";

/**
 * Release bodies (#2197). Type checks only. Titles, credits, moods, dates and
 * the AI disclosure keep the service's own rules: `aiDisclosure` is left
 * undecorated because `normalizeAiDisclosureInput` answers its `400`s.
 */
export class ReleaseArtistCreditDto {
  @IsOptional()
  @IsString()
  artistId?: string | null;

  @IsOptional()
  @IsString()
  displayName?: string | null;

  /** The service falls back to "featured" when it is empty or absent. */
  @IsOptional()
  @IsString()
  role!: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class CreateReleaseTrackDto {
  @IsString()
  title!: string;

  @IsNumber()
  position!: number;

  @IsOptional()
  @IsBoolean()
  explicit?: boolean;

  aiDisclosure!: AiDisclosureInput;
}

export class CreateReleaseDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  primaryArtist?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  featuredArtists?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReleaseArtistCreditDto)
  artistCredits?: ReleaseArtistCreditDto[];

  @IsOptional()
  @IsString()
  genre?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  moods?: string[];

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  releaseDate?: string;

  @IsOptional()
  @IsBoolean()
  explicit?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateReleaseTrackDto)
  tracks?: CreateReleaseTrackDto[];
}

export class UpdateReleaseTrackDto {
  @IsString()
  id!: string;

  aiDisclosure!: AiDisclosureInput;
}

export class UpdateReleaseDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  primaryArtist?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateReleaseTrackDto)
  tracks?: UpdateReleaseTrackDto[];
}
