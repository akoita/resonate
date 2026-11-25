import { ApiRequestError, type TakedownCapacity, type TakedownCategory, type TakedownNoticeInput } from "./api";

/** Reason choices on the report form (#2664), in the order shown. */
export const TAKEDOWN_CATEGORIES: ReadonlyArray<{ value: TakedownCategory; label: string; hint: string }> = [
  { value: "copyright", label: "Copyright", hint: "My work, or work I represent, was uploaded without permission." },
  { value: "impersonation", label: "Impersonation", hint: "Someone is presenting themselves as me or as an artist I represent." },
  { value: "illegal_content", label: "Illegal content", hint: "The content is unlawful for another reason." },
  { value: "other", label: "Something else", hint: "Another rights or safety concern." },
];

export const TAKEDOWN_CAPACITIES: ReadonlyArray<{ value: TakedownCapacity; label: string }> = [
  { value: "rights_holder", label: "I own the rights" },
  { value: "authorized_agent", label: "I act for the rights holder (label, publisher, manager)" },
  { value: "artist_themselves", label: "I am the artist being impersonated" },
  { value: "someone_else", label: "I am reporting something I noticed" },
];

export const TAKEDOWN_STATUS_LABELS: Record<string, string> = {
  pending: "Waiting for review",
  upheld: "Upheld: content removed",
  rejected: "Not upheld: no action",
  countered: "Counter-notice sent",
};

export function takedownCategoryLabel(category: string | null | undefined): string {
  return TAKEDOWN_CATEGORIES.find((c) => c.value === category)?.label ?? "Copyright";
}

export function takedownCapacityLabel(capacity: string | null | undefined): string {
  return TAKEDOWN_CAPACITIES.find((c) => c.value === capacity)?.label ?? "Not stated";
}

export const TAKEDOWN_REASON_MAX = 5000;
export const TAKEDOWN_COUNTER_MAX = 5000;

export interface TakedownFormValues {
  trackId: string;
  claimantName: string;
  claimantCapacity: TakedownCapacity | "";
  claimantEmail: string;
  originalWorkUrl: string;
  contentLocation: string;
  category: TakedownCategory | "";
  reason: string;
  goodFaith: boolean;
  website: string;
}

export const EMPTY_TAKEDOWN_FORM: TakedownFormValues = {
  trackId: "",
  claimantName: "",
  claimantCapacity: "",
  claimantEmail: "",
  originalWorkUrl: "",
  contentLocation: "",
  category: "",
  reason: "",
  goodFaith: false,
  website: "",
};

export type TakedownFormErrors = Partial<Record<keyof TakedownFormValues, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field errors in plain words; an empty object means the form can be sent. */
export function validateTakedownForm(values: TakedownFormValues): TakedownFormErrors {
  const errors: TakedownFormErrors = {};
  if (!values.trackId) errors.trackId = "Choose the track the notice is about.";
  if (!values.claimantName.trim()) errors.claimantName = "Enter your name or your organisation's name.";
  if (!values.claimantCapacity) errors.claimantCapacity = "Say how you are connected to the work.";
  if (!EMAIL.test(values.claimantEmail.trim())) errors.claimantEmail = "Enter an email address we can reach you at.";
  if (!values.originalWorkUrl.trim()) errors.originalWorkUrl = "Name the work concerned, or link to it.";
  if (!values.category) errors.category = "Choose a reason.";
  if (!values.reason.trim()) errors.reason = "Explain what is wrong.";
  else if (values.reason.length > TAKEDOWN_REASON_MAX) errors.reason = `Keep the explanation under ${TAKEDOWN_REASON_MAX} characters.`;
  if (!values.goodFaith) errors.goodFaith = "Confirm the statement to send the notice.";
  return errors;
}

/** The request body for a valid form. */
export function toTakedownNotice(values: TakedownFormValues): TakedownNoticeInput {
  return {
    trackId: values.trackId,
    claimantName: values.claimantName.trim(),
    claimantCapacity: values.claimantCapacity as TakedownCapacity,
    claimantEmail: values.claimantEmail.trim(),
    originalWorkUrl: values.originalWorkUrl.trim(),
    contentLocation: values.contentLocation.trim() || undefined,
    category: values.category as TakedownCategory,
    reason: values.reason.trim(),
    goodFaith: values.goodFaith,
    website: values.website,
  };
}

/**
 * Read a Resonate link the reporter pasted: `/release/<id>` (optionally with
 * `?track=<id>`) or a full URL to one. Returns null for anything else.
 */
export function parseResonateContentLink(raw: string): { releaseId: string; trackId?: string } | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value, "https://resonate.invalid");
  } catch {
    return null;
  }
  const match = /^\/release\/([^/?#]+)\/?$/.exec(url.pathname);
  if (!match) return null;
  const trackId = url.searchParams.get("track") ?? undefined;
  return { releaseId: decodeURIComponent(match[1]), ...(trackId ? { trackId } : {}) };
}

/** A message a reporter can act on, for a failed filing. */
export function takedownErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) {
      return "Too many notices have been sent from this connection in the last hour. Please wait, then try again, or write to us using the contact page.";
    }
    if (error.status === 404) return "That track could not be found. Check the link and choose the track again.";
    if (error.status === 400) return "Some details were not accepted. Check each field, then send again.";
  }
  return "The notice could not be sent. Please try again in a moment.";
}

/** Short form of a reference to read out or type: the first block of the id. */
export function shortReference(id: string): string {
  return id.split("-")[0]?.toUpperCase() ?? id;
}
