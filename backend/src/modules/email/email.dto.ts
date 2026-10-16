import { ArrayMaxSize, IsArray, IsString, MaxLength, isEmail, registerDecorator, type ValidationOptions } from "class-validator";

/** Accepts an address with surrounding spaces; the service stores it trimmed. */
function IsTrimmedEmail(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: "isTrimmedEmail",
      target: target.constructor,
      propertyName,
      options: { message: "address must be a valid email address", ...options },
      validator: {
        validate: (value: unknown) => typeof value === "string" && value.trim().length <= 254 && isEmail(value.trim()),
      },
    });
}

export class SetContactEmailDto {
  @IsTrimmedEmail()
  address!: string;
}

export class ContactEmailPreferencesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  optOuts!: string[];
}

export class EmailTokenDto {
  @IsString()
  @MaxLength(1024)
  token!: string;
}
