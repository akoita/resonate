import { IsIn, IsNotEmpty, IsString, MaxLength } from "class-validator";
import {
  REMIX_WATERMARK_EVIDENCE_SUBJECT_TYPES,
  type RemixWatermarkEvidenceSubjectType,
} from "./remix-watermark-detection.service";

/** Where a remix watermark match is attached as evidence (#2575). */
export class AttachRemixWatermarkEvidenceDto {
  @IsIn(REMIX_WATERMARK_EVIDENCE_SUBJECT_TYPES)
  subjectType!: RemixWatermarkEvidenceSubjectType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subjectId!: string;
}
