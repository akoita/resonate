import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";
import type { QueueCreationContext } from "./playlist.service";

/**
 * Playlist bodies (#2197). Type checks only: unknown fields pass through, and
 * the service keeps the value rules (visibility, queue snapshot consistency).
 */
export class SavePlaylistDto {
  @IsString()
  sourcePlaylistId!: string;
}

export class FolderNameDto {
  @IsString()
  name!: string;
}

export class CreatePlaylistDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  trackIds?: string[];

  /** Checked field by field by `PlaylistService.createPlaylist`. */
  @IsOptional()
  @IsObject()
  queueContext?: QueueCreationContext;
}

export class UpdatePlaylistDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  folderId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  trackIds?: string[];

  @IsOptional()
  @IsString()
  visibility?: string;
}
