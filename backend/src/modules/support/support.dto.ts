import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/** What a support request is about (#2667). */
export const SUPPORT_TOPICS = ["account", "uploads", "payments", "listening", "rights", "other"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

/** Where an operator is with a request. */
export const SUPPORT_STATUSES = ["new", "answered", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 4000;
export const SUPPORT_EMAIL_MAX = 254;

/**
 * Body of `POST /support/requests` (#2667). Open to signed-out visitors, who
 * may leave an email so we can answer. `website` is a honeypot the web form
 * hides from people: a value there means a bot, and nothing is stored.
 */
export class CreateSupportRequestDto {
  @IsIn(SUPPORT_TOPICS)
  topic!: SupportTopic;

  @IsString()
  @MaxLength(SUPPORT_MESSAGE_MAX)
  message!: string;

  @IsOptional()
  @IsEmail({}, { message: "email must be an email address" })
  @MaxLength(SUPPORT_EMAIL_MAX)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

/** Body of `PATCH /admin/support/requests/:id`. */
export class UpdateSupportRequestDto {
  @IsIn(SUPPORT_STATUSES)
  status!: SupportStatus;
}
