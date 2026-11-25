import { IsBoolean } from "class-validator";

/** `POST /api/trust/:artistId/upload-limits` (#2659). */
export class SetUploadLimitsDto {
  @IsBoolean()
  lifted!: boolean;
}
