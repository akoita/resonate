import { IsObject, IsOptional, IsString } from "class-validator";

/**
 * Passkey bodies (#2197). Type checks only; `cred` is the browser's WebAuthn
 * credential JSON, which the WebAuthn library verifies in full.
 */
export class PasskeyRegisterOptionsDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  rpID?: string;
}

export class PasskeyRegisterVerifyDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsObject()
  cred!: any;

  @IsOptional()
  @IsString()
  rpID?: string;
}

export class PasskeyLoginOptionsDto {
  @IsOptional()
  @IsString()
  rpID?: string;
}

export class PasskeyLoginVerifyDto {
  @IsObject()
  cred!: any;

  @IsOptional()
  @IsString()
  rpID?: string;
}
