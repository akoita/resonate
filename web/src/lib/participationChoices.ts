import type { ParticipationConsentChoices } from "./api";

export type ChoiceSetting = keyof ParticipationConsentChoices;

/**
 * How each participation choice reads to the artist (#2666). Ordered so the
 * non-generative choices come first; AI-related choices come last.
 */
export const PARTICIPATION_CHOICES: ReadonlyArray<{
  setting: ChoiceSetting;
  /** The value the box stands for when it is ticked. */
  on: string;
  off: string;
  label: string;
  help: string;
}> = [
  {
    setting: "remixConsent",
    on: "allowed",
    off: "disabled",
    label: "Let listeners remix my music in Remix Studio",
    help: "Remixes credit you and pay you your share. Turning this off stops new remixes and holds published ones.",
  },
  {
    setting: "stemListing",
    on: "allowed",
    off: "disabled",
    label: "Offer my stems as collectibles",
    help: "Lets you list your stems for sale. Off keeps Mint & List turned off until you decide.",
  },
  {
    setting: "aiRemixApproval",
    on: "required",
    off: "not_required",
    label: "Ask me before AI-assisted remixes of my music are shared",
    help: "Others can still make a private draft, but cannot publish or export it while this is on.",
  },
  {
    setting: "aiSourceUse",
    on: "allowed",
    off: "disabled",
    label: "Allow AI-assisted tools to use my music",
    help: "Remix Studio is AI-assisted. Off means nobody else can start a remix of your music.",
  },
];

export function choiceIsOn(choices: ParticipationConsentChoices, setting: ChoiceSetting): boolean {
  const entry = PARTICIPATION_CHOICES.find((c) => c.setting === setting);
  return !!entry && choices[setting] === entry.on;
}

export function withChoice(
  choices: ParticipationConsentChoices,
  setting: ChoiceSetting,
  on: boolean,
): ParticipationConsentChoices {
  const entry = PARTICIPATION_CHOICES.find((c) => c.setting === setting);
  if (!entry) return choices;
  return { ...choices, [setting]: on ? entry.on : entry.off } as ParticipationConsentChoices;
}

/** Only the settings whose value differs, for a PATCH. */
export function changedChoices(
  before: ParticipationConsentChoices,
  after: ParticipationConsentChoices,
): Partial<ParticipationConsentChoices> {
  const out: Partial<ParticipationConsentChoices> = {};
  for (const { setting } of PARTICIPATION_CHOICES) {
    if (before[setting] !== after[setting]) {
      (out as Record<string, string>)[setting] = after[setting];
    }
  }
  return out;
}

/** One history line in plain words, e.g. "Stems as collectibles: on → off". */
export function describeChange(change: { setting: string; previousValue: string | null; value: string }): string {
  const entry = PARTICIPATION_CHOICES.find((c) => c.setting === change.setting);
  if (!entry) return `${change.setting}: ${change.value}`;
  const word = (value: string | null) => (value === null ? "not set" : value === entry.on ? "on" : "off");
  return `${entry.label}: ${word(change.previousValue)} → ${word(change.value)}`;
}
