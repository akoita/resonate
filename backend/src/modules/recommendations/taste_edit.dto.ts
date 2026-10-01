import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { TASTE_EDIT_MAX_TEXT_LENGTH } from "./taste_edit_parser";

/** Body of `POST /recommendations/taste-memory/edits/preview` (#1961). */
export class PreviewTasteEditsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TASTE_EDIT_MAX_TEXT_LENGTH)
  text!: string;
}

/**
 * One confirmed edit. `signalType` and `action` are `null` on an unmapped row
 * echoed back from a preview; the service ignores those. Whether a
 * (signalType, action) pair is allowed is enforced in the service.
 */
export class ConfirmedTasteEditDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  kind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  signalType?: string | null;

  @IsString()
  @MaxLength(80)
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  action?: string | null;
}

/** Body of `POST /recommendations/taste-memory/edits/apply` (#1961). */
export class ApplyTasteEditsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConfirmedTasteEditDto)
  items!: ConfirmedTasteEditDto[];
}
