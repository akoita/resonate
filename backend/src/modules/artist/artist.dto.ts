import { IsString } from "class-validator";

/** Body of `POST /artists` (#2197). Type checks only; both values are written as given. */
export class CreateArtistProfileDto {
  @IsString()
  displayName!: string;

  @IsString()
  payoutAddress!: string;
}
