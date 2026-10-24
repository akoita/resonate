import {
  DISCOVERY_EXPLANATIONS,
  DISCOVERY_EXPLANATION_VARIANTS,
  DISCOVERY_REASON_CODES,
  isTrendingExplanation,
} from "../recommendations/discovery-explanations";
import { normalizeAgentRuntimeResult } from "./agent_runtime.types";
import type { AgentRuntimeRunResult } from "./agent_runtime.types";

/**
 * What Session History says about a pick the DJ queued but the listener has not
 * played yet (#2243). A pick leaves no AgentSignal until it is played, so its
 * explanation is stored with the pick (#2299, the `AgentPickNote` row written
 * in the same transaction as the pick's `License`): bounded, server-authored
 * sentences from the shared vocabulary, read back from any backend instance and
 * after a restart. A pick recorded before notes were kept has none and shows
 * no reason line.
 */
export interface PickNote {
  /** At most two sentences from the shared discovery explanation vocabulary; never model free text. */
  explanation: string[];
  reasonCode?: string;
  /** "llm" only when the AI curator chose it and did not fall back (#2075). */
  curatedBy: "llm" | "rules";
  /**
   * Whether the pick satisfied every filter of the described session (#2312);
   * absent when the session had no filters, and for notes recorded before this.
   */
  requestMatch?: boolean;
}

const SENTENCES_PER_PICK = 2;
const SENTENCE_MAX_LENGTH = 120;
/** Says nothing a listener can use. */
const UNHELPFUL_SENTENCES = new Set([DISCOVERY_EXPLANATIONS.catalog]);

/** The fixed sentences the ranking core and the policy stage can emit. */
const VOCABULARY_SENTENCES: ReadonlySet<string> = new Set([
  ...Object.values(DISCOVERY_EXPLANATIONS),
  ...Object.values(DISCOVERY_EXPLANATION_VARIANTS),
  "Fits your current mix request.",
]);
/** Templated by a bounded value: the energy band, or a measured BPM range. */
const TEMPLATED_SENTENCES: readonly RegExp[] = [
  /^(low|medium|high) energy match$/,
  /^(?:\d{1,3}(?:\u2013\d{1,3})?|under \d{1,3}|over \d{1,3}) BPM match$/,
];
/** "From your {cohort} cohort" names a community, so a note keeps the generic scene sentence instead. */
const COHORT_SENTENCE = /^From your .+ cohort$/;
const REASON_CODES: ReadonlySet<string> = new Set(DISCOVERY_REASON_CODES);

/**
 * The sentence a note may store for one explanation line, or undefined when it
 * is not in the shared vocabulary (a model's free text is never persisted).
 */
function vocabularySentence(line: unknown): string | undefined {
  if (typeof line !== "string") return undefined;
  const sentence = line.trim();
  if (!sentence || sentence.length > SENTENCE_MAX_LENGTH) return undefined;
  if (COHORT_SENTENCE.test(sentence)) return DISCOVERY_EXPLANATIONS.scene;
  // "Trending in {family} this week" (#2246): templated by a closed family label.
  if (isTrendingExplanation(sentence)) return sentence;
  if (VOCABULARY_SENTENCES.has(sentence) || TEMPLATED_SENTENCES.some((pattern) => pattern.test(sentence))) {
    return sentence;
  }
  return undefined;
}

/** What is stored for one pick: a `PickNote` as the `AgentPickNote` columns. */
export function pickNoteColumns(note: PickNote) {
  return {
    explanation: note.explanation,
    reasonCode: note.reasonCode ?? null,
    curatedBy: note.curatedBy,
    requestMatch: typeof note.requestMatch === "boolean" ? note.requestMatch : null,
  };
}

/** A stored `AgentPickNote` row (or none: a pick recorded before notes were kept) as a `PickNote`. */
export function pickNoteFromRow(
  row: { explanation: string[]; reasonCode: string | null; curatedBy: string; requestMatch: boolean | null } | null | undefined,
): PickNote | undefined {
  if (!row) return undefined;
  return {
    explanation: row.explanation,
    ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
    curatedBy: row.curatedBy === "llm" ? "llm" : "rules",
    ...(typeof row.requestMatch === "boolean" ? { requestMatch: row.requestMatch } : {}),
  };
}

/** One pick's bounded note: vocabulary sentences only, categorical code, boolean flag. */
export function shapePickNote(
  track: { explanation?: unknown; reasonCode?: unknown; requestMatch?: unknown },
  curatedBy: PickNote["curatedBy"],
): PickNote {
  const sentences = Array.isArray(track.explanation) ? track.explanation : [];
  const explanation: string[] = [];
  for (const line of sentences) {
    const sentence = vocabularySentence(line);
    if (!sentence || UNHELPFUL_SENTENCES.has(sentence) || explanation.includes(sentence)) continue;
    explanation.push(sentence);
    if (explanation.length === SENTENCES_PER_PICK) break;
  }
  return {
    explanation,
    ...(typeof track.reasonCode === "string" && REASON_CODES.has(track.reasonCode)
      ? { reasonCode: track.reasonCode }
      : {}),
    curatedBy,
    ...(typeof track.requestMatch === "boolean" ? { requestMatch: track.requestMatch } : {}),
  };
}

/** "llm" only when the AI curator chose the picks and did not fall back; a fallback is never an AI pick (#2075). */
export function pickCurator(result: { curatedBy?: string; runtimeFallback?: unknown }): PickNote["curatedBy"] {
  return result.curatedBy === "llm" && !result.runtimeFallback ? "llm" : "rules";
}

/** The picks' notes from a raw runtime result (rule-based or LLM). */
export function pickNotesFromRunResult(result: AgentRuntimeRunResult): Map<string, PickNote> {
  const normalized = normalizeAgentRuntimeResult(result);
  // The policy step may add a fallback marker; a fallback is never an AI pick.
  const curatedBy = pickCurator(normalized);
  const notes = new Map<string, PickNote>();
  for (const track of normalized.tracks) {
    notes.set(track.trackId, shapePickNote(track, curatedBy));
  }
  return notes;
}

/**
 * The Session History `recommendation` of a license row: the signal recorded
 * when the listener acted on the pick, else (a pick not played yet) the note
 * the run produced. A note's signal fields still win over its own (as before).
 */
export function historyRecommendation(
  note: PickNote | undefined,
  signal: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!note) return signal ?? null;
  return {
    recommendation: {
      explanation: note.explanation,
      ...(note.reasonCode ? { reasonCode: note.reasonCode } : {}),
    },
    curatedBy: note.curatedBy,
    ...(typeof note.requestMatch === "boolean" ? { requestMatch: note.requestMatch } : {}),
    ...(signal ?? {}),
  };
}
