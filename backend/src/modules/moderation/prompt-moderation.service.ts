import { Injectable } from "@nestjs/common";

/**
 * Prompt-safety moderation for the self-hosted AI generation path (#1343).
 *
 * Unlike Lyria (Google-hosted, vendor safety filters mapped to
 * `provider_rejected`), the self-hosted Stable Audio 3 worker has **no** vendor
 * filter — Resonate is the enforcement layer. The Gemma Prohibited Use Policy,
 * flowed down via the Gemma Terms (§3.1/§3.2) and recorded in
 * `docs/compliance/ai_generation_acceptable_use.md`, requires enforceable use
 * restrictions on this path before real-user enablement.
 *
 * ## Philosophy: precision over recall (with one exception)
 *
 * These prompts generate **music**. Musical language is saturated with
 * dark/violent/explicit-*adjacent* terms used entirely legitimately — "killer
 * bassline", "dark trap", "explosive drop", "sick beat", songs *about* crime,
 * war, drugs, heartbreak, or sex as artistic themes. A broad keyword blocklist
 * would reject far more legitimate art than actual abuse, so this v1 screens for
 * **unambiguous intent** — explicit instructions to produce prohibited content,
 * safety-bypass attempts, or voice-cloning of a real person — NOT thematic
 * keywords. Ambiguous artistic prompts are allowed by design.
 *
 * The single exception is **sexualization of minors**: zero tolerance, biased
 * toward blocking. Any co-occurrence of sexual language with a minor indicator
 * is rejected.
 *
 * This is a deliberately cheap, deterministic, rule-based first line (no extra
 * LLM round-trip per draft). A future upgrade path is a lightweight classifier
 * for the harder ambiguous cases (tracked in the issue); the interface here is
 * stable so that swap is internal.
 */

export const PROMPT_MODERATION_CATEGORIES = [
  "sexual_minor",
  "sexual_explicit",
  "deceptive_impersonation",
  "illegal_malicious",
] as const;

export type PromptModerationCategory =
  (typeof PROMPT_MODERATION_CATEGORIES)[number];

export type PromptModerationResult =
  | { allowed: true }
  | {
      allowed: false;
      category: PromptModerationCategory;
      /** Machine reason code carried on analytics (`prompt_moderation:<cat>`). */
      reasonCode: string;
      /** User-facing, non-preachy explanation. Never echoes the matched text. */
      message: string;
    };

type Rule = {
  category: PromptModerationCategory;
  pattern: RegExp;
};

// Minor indicators — used ONLY in combination with sexual language (never on
// their own; a song *about* childhood is fine). Deliberately EXCLUDES terms
// that collide with everyday music language: "baby" (adult-romance staple),
// "kid" (slang), and "minor" (musical minor key). Ages are bounded to ≤17 so
// "18/21 year old" is not treated as a minor. "teen" is kept (conservative bias
// on the minor-sexualization axis, accepting rare false positives).
const MINOR_TERMS =
  "child|children|infant|toddler|underage|under[-\\s]?age|pre[-\\s]?teen|preteen|pre[-\\s]?pubescent|prepubescent|teen|teenage|teenager|schoolgirl|schoolboy|loli|shota|(?:[1-9]|1[0-7])[-\\s]?(?:year|yr)s?[-\\s]?old";

// Explicit sexual-act / pornographic vocabulary. Kept to unambiguous terms,
// word-bounded, so artistic "sensual", "seductive", "love song" prompts are NOT
// caught. Single words carry \b to avoid substring hits (e.g. "grape"→"rape").
const SEXUAL_EXPLICIT_TERMS =
  "\\bporn\\w*|\\bblowjob\\b|\\bhandjob\\b|\\bcumshot\\b|\\bgangbang\\b|\\bbestiality\\b|\\brape\\b|hardcore\\s+sex|explicit\\s+sex(?:ual)?\\s+(?:act|content)|sexual\\s+intercourse|non[-\\s]?consensual\\s+sex";

const RULES: Rule[] = [
  // ── Category: sexual content involving minors (ZERO TOLERANCE) ──────────────
  // Sexual/explicit term within ~40 chars of a minor indicator, in either order.
  {
    category: "sexual_minor",
    pattern: new RegExp(
      `(?:${SEXUAL_EXPLICIT_TERMS}|sexy|sexual|erotic|nude|naked|nsfw)[^.!?\\n]{0,40}(?:${MINOR_TERMS})`,
      "i",
    ),
  },
  {
    category: "sexual_minor",
    pattern: new RegExp(
      `(?:${MINOR_TERMS})[^.!?\\n]{0,40}(?:${SEXUAL_EXPLICIT_TERMS}|sexy|sexual|erotic|nude|naked|nsfw)`,
      "i",
    ),
  },

  // ── Category: sexually explicit (non-artistic) ─────────────────────────────
  { category: "sexual_explicit", pattern: new RegExp(`(?:${SEXUAL_EXPLICIT_TERMS})`, "i") },

  // ── Category: deceptive impersonation (voice-clone a REAL person) ──────────
  // "clone/imitate/replicate/fake the (real) voice of X" — explicit cloning
  // INTENT. Plain style references ("in the style of Drake") are allowed: they
  // do not match "clone/impersonate ... voice".
  {
    category: "deceptive_impersonation",
    pattern:
      /\b(?:clone|cloning|imitate|imitating|replicate|replicating|deepfake|deep[-\s]?fake|impersonat(?:e|ing)|mimic(?:king)?|fake)\b[^.!?\n]{0,30}\bvoice\b/i,
  },
  {
    category: "deceptive_impersonation",
    pattern:
      /\bvoice\b[^.!?\n]{0,20}\b(?:clone|cloned|cloning|deepfake|deep[-\s]?fake)\b/i,
  },
  {
    category: "deceptive_impersonation",
    pattern:
      /\bmake\s+it\s+sound\s+(?:exactly\s+)?like\s+(?:the\s+)?(?:real\s+)?[A-Z][^.!?\n]{0,30}\b(?:actual|real)\s+voice\b/i,
  },

  // ── Category: illegal / malicious (incl. safety-filter circumvention) ──────
  // Jailbreak / safety-bypass attempts.
  {
    category: "illegal_malicious",
    pattern:
      /\b(?:ignore|bypass|disable|circumvent|override|jailbreak|get\s+around)\b[^.!?\n]{0,30}\b(?:safety|filter|filters|guard[-\s]?rails?|moderation|restrictions?|policy|policies|rules?)\b/i,
  },
  { category: "illegal_malicious", pattern: /\b(?:jailbreak|dan\s+mode|do\s+anything\s+now)\b/i },
  // Explicit instructions to build weapons / explosives (not "explosive drop").
  {
    category: "illegal_malicious",
    pattern:
      /\b(?:how\s+to\s+(?:make|build|create|synthesi[sz]e)|instructions?\s+for|recipe\s+for)\b[^.!?\n]{0,30}\b(?:bomb|explosive|explosives|weapon|nerve\s+agent|meth(?:amphetamine)?|fentanyl|bioweapon|dirty\s+bomb)\b/i,
  },
];

@Injectable()
export class PromptModerationService {
  /** Disabled only when explicitly turned off; safety is on by default. */
  private readonly enabled =
    (process.env.PROMPT_MODERATION_ENABLED ?? "true").toLowerCase() !== "false";

  private static readonly MESSAGES: Record<PromptModerationCategory, string> = {
    sexual_minor:
      "This prompt can’t be used: it appears to request sexual content involving minors, which is never allowed.",
    sexual_explicit:
      "This prompt can’t be used: it appears to request sexually explicit content. Try describing the music instead.",
    deceptive_impersonation:
      "This prompt can’t be used: cloning or impersonating a real person’s voice isn’t allowed. You can reference a genre or style instead.",
    illegal_malicious:
      "This prompt can’t be used: it appears to request illegal or unsafe content, or to bypass safety controls.",
  };

  /**
   * Screen a generation prompt. Pure and synchronous — safe to call before any
   * paid/queued work. Returns `{ allowed: true }` for empty prompts (nothing to
   * screen) and when moderation is disabled.
   */
  screen(prompt: string | null | undefined): PromptModerationResult {
    if (!this.enabled) return { allowed: true };
    const text = (prompt ?? "").trim();
    if (!text) return { allowed: true };

    for (const rule of RULES) {
      if (rule.pattern.test(text)) {
        return {
          allowed: false,
          category: rule.category,
          reasonCode: `prompt_moderation:${rule.category}`,
          message: PromptModerationService.MESSAGES[rule.category],
        };
      }
    }
    return { allowed: true };
  }
}
