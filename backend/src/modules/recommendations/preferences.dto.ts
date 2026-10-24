import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import type { UserPreferences } from "./recommendations.service";

/** `preferences` of POST /recommendations/preferences (#2197); types only. */
export class UserPreferencesDto implements UserPreferences {
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
}

/** The ownership check (`assertOwnUser`) runs in the handler on `userId`. */
export class SetPreferencesDto {
  @IsString()
  userId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => UserPreferencesDto)
  preferences!: UserPreferencesDto;
}
