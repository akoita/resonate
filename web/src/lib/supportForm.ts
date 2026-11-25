/**
 * Contact support (#2667): topics, limits, validation and plain error copy
 * for the public form. Pure, so the rules are tested without a browser.
 */
import { ApiRequestError, type SupportRequestStatus, type SupportTopic } from "./api";

export const SUPPORT_TOPICS: ReadonlyArray<{ value: SupportTopic; label: string }> = [
  { value: "account", label: "My account or signing in" },
  { value: "listening", label: "Listening and my library" },
  { value: "uploads", label: "Uploading or managing music" },
  { value: "payments", label: "Payments, purchases or refunds" },
  { value: "rights", label: "Rights, credits or a dispute" },
  { value: "other", label: "Something else" },
];

export const SUPPORT_STATUS_LABELS: Record<SupportRequestStatus, string> = {
  new: "New",
  answered: "Answered",
  closed: "Closed",
};

export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 4000;

export interface SupportFormValues {
  topic: SupportTopic | "";
  message: string;
  email: string;
  website: string;
}

export const EMPTY_SUPPORT_FORM: SupportFormValues = { topic: "", message: "", email: "", website: "" };

export type SupportFormErrors = Partial<Record<"topic" | "message" | "email", string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function supportTopicLabel(topic: string): string {
  return SUPPORT_TOPICS.find((option) => option.value === topic)?.label ?? topic;
}

export function validateSupportForm(values: SupportFormValues): SupportFormErrors {
  const errors: SupportFormErrors = {};
  if (!values.topic) errors.topic = "Choose what your message is about.";
  const message = values.message.trim();
  if (message.length < SUPPORT_MESSAGE_MIN) {
    errors.message = `Tell us a little more (at least ${SUPPORT_MESSAGE_MIN} characters).`;
  } else if (message.length > SUPPORT_MESSAGE_MAX) {
    errors.message = `Keep it under ${SUPPORT_MESSAGE_MAX} characters.`;
  }
  const email = values.email.trim();
  if (email && !EMAIL_PATTERN.test(email)) errors.email = "Enter an email address like name@example.com, or leave it empty.";
  return errors;
}

export function supportErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) {
      return "You have sent several messages recently. We will answer them; please wait before sending another.";
    }
    if (error.status === 400) return "Some details were not accepted. Check each field, then send again.";
  }
  return "Your message could not be sent. Please try again in a moment.";
}
