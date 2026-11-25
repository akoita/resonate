import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class InvitationCodeDto {
  @IsString()
  @MaxLength(64)
  code!: string;
}

export class CreateInvitationDto {
  @IsIn(["listener", "artist"])
  role!: "listener" | "artist";

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxUses?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class JoinWaitlistDto {
  @IsString()
  @MaxLength(254)
  email!: string;

  @IsIn(["listener", "artist"])
  kind!: "listener" | "artist";

  @IsBoolean()
  consent!: boolean;
}
