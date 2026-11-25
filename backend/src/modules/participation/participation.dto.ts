import { Type } from "class-transformer";
import { IsIn, IsOptional, IsString, Length, MaxLength, ValidateNested } from "class-validator";

/** Body of `PATCH /artists/:id/participation/choices` (#2666): any subset. */
export class ConsentChoicesDto {
  @IsOptional()
  @IsIn(["allowed", "disabled"])
  remixConsent?: "allowed" | "disabled";

  @IsOptional()
  @IsIn(["required", "not_required"])
  aiRemixApproval?: "required" | "not_required";

  @IsOptional()
  @IsIn(["allowed", "disabled"])
  aiSourceUse?: "allowed" | "disabled";

  @IsOptional()
  @IsIn(["allowed", "disabled"])
  stemListing?: "allowed" | "disabled";
}

/** Body of `POST /artists/:id/participation/accept` (#2666). */
export class AcceptParticipationDto {
  @IsString()
  @MaxLength(64)
  version!: string;

  @IsString()
  @Length(64, 64)
  textHash!: string;

  @ValidateNested()
  @Type(() => ConsentChoicesDto)
  choices!: ConsentChoicesDto;
}
