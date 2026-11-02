import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

/**
 * Library bodies (#2197). Type checks only: unknown fields pass through and the
 * service keeps its own value handling. Every field reaches a Prisma column, so
 * a wrong type used to surface as a 500 from the client instead of a 400.
 */
export class SaveLibraryTrackDto {
  @IsOptional()
  @IsString()
  id?: string;

  /**
   * Required (#2505): "local" is a device file, "remote" a platform track or
   * stem. The service rejects a row that mixes the two.
   */
  @IsIn(["local", "remote"])
  source!: "local" | "remote";

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  artist?: string | null;

  @IsOptional()
  @IsString()
  albumArtist?: string | null;

  @IsOptional()
  @IsString()
  album?: string | null;

  @IsOptional()
  @IsInt()
  year?: number | null;

  @IsOptional()
  @IsString()
  genre?: string | null;

  @IsOptional()
  @IsNumber()
  duration?: number | null;

  @IsOptional()
  @IsString()
  sourcePath?: string | null;

  @IsOptional()
  @IsInt()
  fileSize?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceFolder?: string | null;

  @IsOptional()
  @IsString()
  catalogTrackId?: string | null;

  @IsOptional()
  @IsString()
  remoteUrl?: string | null;

  @IsOptional()
  @IsString()
  remoteArtworkUrl?: string | null;

  @IsOptional()
  @IsString()
  stemType?: string | null;

  @IsOptional()
  @IsString()
  tokenId?: string | null;

  @IsOptional()
  @IsString()
  listingId?: string | null;

  @IsOptional()
  @IsString()
  purchaseDate?: string | null;

  @IsOptional()
  @IsBoolean()
  isOwned?: boolean;

  @IsOptional()
  @IsString()
  previewUrl?: string | null;
}

export class SaveLibraryTracksDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveLibraryTrackDto)
  tracks!: SaveLibraryTrackDto[];
}

export class DeleteLibraryTracksDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}
