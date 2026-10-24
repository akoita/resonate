import { IsArray, IsString } from "class-validator";

/**
 * Body of the legacy in-memory `POST /remix/create` (#2197); types only. The
 * durable path is `POST /remix/projects` with `CreateRemixProjectDto`.
 */
export class CreateLegacyRemixDto {
  @IsString()
  sourceTrackId!: string;

  @IsArray()
  @IsString({ each: true })
  stemIds!: string[];

  @IsString()
  title!: string;
}
