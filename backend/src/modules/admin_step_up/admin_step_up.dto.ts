import { IsString, Length, Matches } from "class-validator";

/** Body of `POST /admin/step-up/verify` (#2173). */
export class VerifyAdminStepUpDto {
  /** The address the challenge named; checked against the signed-in account. */
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: "address must be a 0x wallet address" })
  address!: string;

  /** The signature over the challenge message. Smart-account signatures can be long (ERC-6492). */
  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/, { message: "signature must be 0x-prefixed hex" })
  @Length(4, 20_000)
  signature!: string;

  /** The opaque challenge returned by `POST /admin/step-up/challenge`. */
  @IsString()
  @Length(10, 2_000)
  challengeToken!: string;
}
