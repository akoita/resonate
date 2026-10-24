import { IsOptional, IsString } from "class-validator";

/**
 * POST /ingestion/upload form fields (#2197). Type checks only. `metadata`
 * arrives as a JSON string from a form and as an object from a JSON body, so it
 * stays undecorated; the controller parses it and the service validates it.
 */
export class UploadFormDto {
  @IsOptional()
  @IsString()
  artistId?: string;

  /** Reuse the audio of one of the caller's own catalog tracks. */
  @IsOptional()
  @IsString()
  trackId?: string;

  metadata?: any;
}
