import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

/**
 * `POST /billing/withdrawals` (#2594): the withdrawal statement. The client
 * names the contract from `GET /billing/withdrawals`; whether the right still
 * exists, and what is refunded, are decided by the server.
 */
export class SubmitWithdrawalDto {
  @IsIn(["artist_pro", "credit_topup"])
  contract!: "artist_pro" | "credit_topup";

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  subjectId!: string;

  /** Who is withdrawing, as typed in the statement form. */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}
