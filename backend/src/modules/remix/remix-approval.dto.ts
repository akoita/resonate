import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { REMIX_APPROVAL_TEXT_MAX } from "./remix-approval.service";

/** Ask the source artist to approve the current draft version (#2682). */
export class RequestRemixApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(REMIX_APPROVAL_TEXT_MAX)
  message?: string;
}

/** The artist's answer on one approval request (#2682). */
export class DecideRemixApprovalDto {
  @IsIn(["approve", "decline"])
  decision!: "approve" | "decline";

  @IsOptional()
  @IsString()
  @MaxLength(REMIX_APPROVAL_TEXT_MAX)
  reason?: string;
}
