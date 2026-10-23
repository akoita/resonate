import { normalizeAgentRuntimeResult } from "./agent_runtime.types";
import type { AgentRuntimeRunResult } from "./agent_runtime.types";

/**
 * What Session History says about a pick the DJ queued but the listener has not
 * played yet (#2243). A pick leaves no AgentSignal until it is played, so its
 * explanation would be lost; this keeps the server-authored sentences from the
 * run for the web's "Now & Up next" card. Owner-bound, bounded and ephemeral,
 * like the My Mix batch order: after a restart (or on another instance) the
 * history simply carries no note and the card shows no reason line.
 */
export interface PickNote {
  /** Sentences from the shared discovery explanation vocabulary; never model free text. */
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

const SESSION_LIMIT = 200;
const SENTENCES_PER_PICK = 2;
const SENTENCE_MAX_LENGTH = 120;
/** Says nothing a listener can use. */
const UNHELPFUL_SENTENCES = new Set(["Catalog candidate"]);

const notesBySession = new Map<string, Map<string, PickNote>>();

const cacheKey = (userId: string, sessionId: string) => `${userId}:${sessionId}`;

/** The picks' notes from a raw runtime result (rule-based or LLM). */
export function pickNotesFromRunResult(result: AgentRuntimeRunResult): Map<string, PickNote> {
  const normalized = normalizeAgentRuntimeResult(result);
  // The policy step may add a fallback marker; a fallback is never an AI pick.
  const curatedBy = normalized.curatedBy === "llm" && !normalized.runtimeFallback ? "llm" : "rules";
  const notes = new Map<string, PickNote>();
  for (const track of normalized.tracks) {
    const explanation = (track.explanation ?? [])
      .filter((line): line is string => typeof line === "string")
      .map((line) => line.trim().slice(0, SENTENCE_MAX_LENGTH))
      .filter((line) => line && !UNHELPFUL_SENTENCES.has(line))
      .slice(0, SENTENCES_PER_PICK);
    notes.set(track.trackId, {
      explanation,
      ...(track.reasonCode ? { reasonCode: track.reasonCode } : {}),
      curatedBy,
      ...(typeof track.requestMatch === "boolean" ? { requestMatch: track.requestMatch } : {}),
    });
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

export function rememberPickNotes(userId: string, sessionId: string, notes: Map<string, PickNote>): void {
  if (notes.size === 0) return;
  const key = cacheKey(userId, sessionId);
  const merged = new Map(notesBySession.get(key) ?? []);
  for (const [trackId, note] of notes) merged.set(trackId, note);
  notesBySession.delete(key);
  notesBySession.set(key, merged);
  if (notesBySession.size > SESSION_LIMIT) {
    notesBySession.delete(notesBySession.keys().next().value!);
  }
}

export function getPickNotes(userId: string, sessionId: string): Map<string, PickNote> | undefined {
  return notesBySession.get(cacheKey(userId, sessionId));
}

export function clearPickNotes(userId: string, sessionId: string): void {
  notesBySession.delete(cacheKey(userId, sessionId));
}
