import { Injectable, Logger } from "@nestjs/common";
import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";

const DEFAULT_MODEL_TIMEOUT_MS = 6_000;
const MIN_MODEL_TIMEOUT_MS = 1_000;
const MAX_MODEL_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_MODEL_ASSISTS_PER_QUEUE = 10;
const MAX_MODEL_ASSISTS_PER_QUEUE = 25;
const DEFAULT_MODEL_CONCURRENCY = 3;
const MAX_MODEL_CONCURRENCY = 5;
const MODERATION_ASSIST_SUMMARY_LIMIT = 240;
const MODERATION_ASSIST_FOCUS_LIMIT = 4;
const MODERATION_ASSIST_FOCUS_TEXT_LIMIT = 160;

const MODERATION_ASSIST_SAFETY_PATTERN =
  /\b(threat(?:en(?:ed|ing|s)?)?|harm(?:ed|ful|ing|s)?|abus(?:e|ed|ive|ing)|harass(?:ed|es|ing|ment)?|hat(?:e|eful)|violence|violent|unsafe|safety)\b/;
const MODERATION_ASSIST_PRIVACY_PATTERN =
  /\b(private|privacy|doxx?(?:ed|es|ing)?|emails?|wallets?|addresses?|personal)\b/;
const MODERATION_ASSIST_SPAM_PATTERN =
  /\b(spam(?:med|ming|my)?|scam(?:med|mer|ming|s)?|phish(?:ed|ing)?|fraud|bots?)\b/;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const WALLET_ADDRESS_PATTERN = /\b0x[a-fA-F0-9]{40}\b/g;

const MODERATION_ASSIST_REASON_CODES = [
  "message_unavailable",
  "message_not_visible",
  "repeated_message_reports",
  "room_report_cluster",
  "room_status_review",
  "safety_language_signal",
  "privacy_language_signal",
  "spam_language_signal",
  "single_report_review",
] as const;
const MODERATION_ASSIST_REASON_CODE_SET = new Set<string>(MODERATION_ASSIST_REASON_CODES);
const MODERATION_ASSIST_LEVELS = ["low", "medium", "high"] as const;
const MODERATION_ASSIST_LEVEL_SET = new Set<string>(MODERATION_ASSIST_LEVELS);

const MODEL_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    severity: { type: SchemaType.STRING, format: "enum", enum: [...MODERATION_ASSIST_LEVELS] },
    likelihood: { type: SchemaType.STRING, format: "enum", enum: [...MODERATION_ASSIST_LEVELS] },
    reasonCodes: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING, format: "enum", enum: [...MODERATION_ASSIST_REASON_CODES] },
    },
    reviewFocus: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
  },
  required: ["summary", "severity", "likelihood", "reasonCodes", "reviewFocus"],
};

export type CommunityModerationAssistStrategy = "deterministic" | "model-assisted";
export type CommunityModerationAssistLevel = (typeof MODERATION_ASSIST_LEVELS)[number];

export type CommunityModerationAssistInput = {
  reason: string;
  room: {
    id: string;
    roomType: string;
    ownerType: string;
    ownerId: string;
    artistId: string | null;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  message: {
    id: string;
    roomId: string;
    authorUserId: string;
    bodyPreview: string | null;
    messageType: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  } | null;
  context: {
    roomOpenReports: number;
    messageReportCount: number;
    roomMembershipsByStatus: Record<string, number>;
  };
};

export type CommunityModerationAssist = {
  summary: string;
  severity: CommunityModerationAssistLevel;
  likelihood: CommunityModerationAssistLevel;
  reasonCodes: string[];
  reviewFocus: string[];
  source: "bounded_moderation_context";
  strategy: CommunityModerationAssistStrategy;
  model?: string;
  fallbackReason?: string;
  advisory: {
    noAutoEnforcement: true;
    copy: string;
  };
};

type ModerationAssistSignals = {
  reasonCodes: string[];
  messageReportCount: number;
  roomOpenReports: number;
};

type ModelModerationAssistResponse = {
  summary: string;
  severity: CommunityModerationAssistLevel;
  likelihood: CommunityModerationAssistLevel;
  reasonCodes: string[];
  reviewFocus: string[];
};

@Injectable()
export class CommunityModerationAssistService {
  private readonly logger = new Logger(CommunityModerationAssistService.name);
  private activeModelCalls = 0;
  private readonly modelWaiters: Array<() => void> = [];

  maxModelAssistsPerQueue() {
    const parsed = Number(process.env.COMMUNITY_MODERATION_ASSIST_MAX_MODEL_REPORTS);
    if (!Number.isFinite(parsed)) return DEFAULT_MAX_MODEL_ASSISTS_PER_QUEUE;
    return Math.min(MAX_MODEL_ASSISTS_PER_QUEUE, Math.max(0, Math.floor(parsed)));
  }

  async buildAssist(
    input: CommunityModerationAssistInput,
    options: { allowModel?: boolean } = {},
  ): Promise<CommunityModerationAssist> {
    const deterministic = this.deterministicAssist(input);
    if (this.strategy() !== "model-assisted") {
      return deterministic;
    }
    if (options.allowModel === false) {
      return { ...deterministic, fallbackReason: "model_assist_queue_cap" };
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return { ...deterministic, fallbackReason: "missing_google_ai_api_key" };
    }

    try {
      const modelName = this.modelName();
      const response = await this.summarizeWithModel(apiKey, modelName, input, deterministic, this.timeoutMs());
      return this.applyStrictGuards(deterministic, response, modelName);
    } catch (error) {
      this.logger.warn(`Model-backed moderation assist failed; using deterministic fallback: ${this.describeError(error)}`);
      return { ...deterministic, fallbackReason: "model_assist_failure" };
    }
  }

  deterministicAssist(input: CommunityModerationAssistInput): CommunityModerationAssist {
    const signals = this.collectSignals(input);
    const severity = this.severity(signals);
    const likelihood = this.likelihood(signals);
    return {
      summary: this.summary(input, signals),
      severity,
      likelihood,
      reasonCodes: signals.reasonCodes,
      reviewFocus: this.reviewFocus(input, signals),
      source: "bounded_moderation_context",
      strategy: "deterministic",
      advisory: moderationAssistAdvisory(),
    };
  }

  private async summarizeWithModel(
    apiKey: string,
    modelName: string,
    input: CommunityModerationAssistInput,
    deterministic: CommunityModerationAssist,
    timeoutMs: number,
  ): Promise<ModelModerationAssistResponse> {
    return this.withModelSlot(async () => {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.systemInstruction(),
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: MODEL_RESPONSE_SCHEMA,
        },
      });

      const response = await this.withTimeout(model.generateContent(this.userPrompt(input, deterministic)), timeoutMs);
      return this.parseResponse(response.response.text());
    });
  }

  private applyStrictGuards(
    deterministic: CommunityModerationAssist,
    response: ModelModerationAssistResponse,
    modelName: string,
  ): CommunityModerationAssist {
    const reasonCodes = unique([
      ...deterministic.reasonCodes,
      ...response.reasonCodes.filter((code) => MODERATION_ASSIST_REASON_CODE_SET.has(code)),
    ]);
    const reviewFocus = response.reviewFocus
      .map((item) => safeModelText(item, MODERATION_ASSIST_FOCUS_TEXT_LIMIT))
      .filter(Boolean)
      .slice(0, MODERATION_ASSIST_FOCUS_LIMIT);

    return {
      summary: safeModelText(response.summary, MODERATION_ASSIST_SUMMARY_LIMIT) || deterministic.summary,
      severity: MODERATION_ASSIST_LEVEL_SET.has(response.severity) ? response.severity : deterministic.severity,
      likelihood: MODERATION_ASSIST_LEVEL_SET.has(response.likelihood) ? response.likelihood : deterministic.likelihood,
      reasonCodes: reasonCodes.length ? reasonCodes : deterministic.reasonCodes,
      reviewFocus: reviewFocus.length ? reviewFocus : deterministic.reviewFocus,
      source: "bounded_moderation_context",
      strategy: "model-assisted",
      model: modelName,
      advisory: moderationAssistAdvisory(),
    };
  }

  private parseResponse(text: string): ModelModerationAssistResponse {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("malformed_moderation_assist_json");
    }

    if (!isRecord(parsed)) {
      throw new Error("invalid_moderation_assist_shape");
    }
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const severity = parseLevel(parsed.severity);
    const likelihood = parseLevel(parsed.likelihood);
    const reasonCodes = Array.isArray(parsed.reasonCodes)
      ? parsed.reasonCodes.filter((code): code is string => typeof code === "string")
      : [];
    const reviewFocus = Array.isArray(parsed.reviewFocus)
      ? parsed.reviewFocus.filter((item): item is string => typeof item === "string")
      : [];

    if (!summary || !severity || !likelihood || reviewFocus.length === 0) {
      throw new Error("invalid_moderation_assist_shape");
    }

    return { summary, severity, likelihood, reasonCodes, reviewFocus };
  }

  private collectSignals(input: CommunityModerationAssistInput): ModerationAssistSignals {
    const reasonCodes = new Set<string>();
    const text = `${input.reason} ${input.message?.bodyPreview ?? ""}`.toLowerCase();
    const messageReportCount = input.context.messageReportCount;
    const roomOpenReports = input.context.roomOpenReports;

    if (!input.message) reasonCodes.add("message_unavailable");
    if (input.message?.status && input.message.status !== "visible") reasonCodes.add("message_not_visible");
    if (messageReportCount >= 2) reasonCodes.add("repeated_message_reports");
    if (roomOpenReports >= 3) reasonCodes.add("room_report_cluster");
    if (input.room.status !== "active") reasonCodes.add("room_status_review");
    if (MODERATION_ASSIST_SAFETY_PATTERN.test(text)) reasonCodes.add("safety_language_signal");
    if (MODERATION_ASSIST_PRIVACY_PATTERN.test(text)) reasonCodes.add("privacy_language_signal");
    if (MODERATION_ASSIST_SPAM_PATTERN.test(text)) reasonCodes.add("spam_language_signal");
    if (reasonCodes.size === 0) reasonCodes.add("single_report_review");

    return {
      reasonCodes: [...reasonCodes],
      messageReportCount,
      roomOpenReports,
    };
  }

  private severity(signals: ModerationAssistSignals): CommunityModerationAssistLevel {
    if (
      signals.reasonCodes.includes("privacy_language_signal") ||
      signals.reasonCodes.includes("safety_language_signal") ||
      signals.messageReportCount >= 3 ||
      signals.roomOpenReports >= 5
    ) {
      return "high";
    }
    if (
      signals.reasonCodes.includes("spam_language_signal") ||
      signals.reasonCodes.includes("room_status_review") ||
      signals.messageReportCount >= 2 ||
      signals.roomOpenReports >= 3
    ) {
      return "medium";
    }
    return "low";
  }

  private likelihood(signals: ModerationAssistSignals): CommunityModerationAssistLevel {
    if (signals.messageReportCount >= 3 || signals.roomOpenReports >= 5) return "high";
    if (
      signals.messageReportCount >= 2 ||
      signals.roomOpenReports >= 3 ||
      signals.reasonCodes.some((code) => code.endsWith("_language_signal"))
    ) {
      return "medium";
    }
    return "low";
  }

  private summary(input: CommunityModerationAssistInput, signals: ModerationAssistSignals) {
    if (!input.message) {
      return "Report needs human review because the original message is unavailable in the moderation preview.";
    }
    if (signals.reasonCodes.includes("privacy_language_signal")) {
      return "Report mentions possible privacy exposure. Review the preview before choosing any action.";
    }
    if (signals.reasonCodes.includes("safety_language_signal")) {
      return "Report mentions possible safety or harassment concerns. Review message context before acting.";
    }
    if (signals.reasonCodes.includes("spam_language_signal")) {
      return "Report may involve spam or scam-like behavior. Check whether the message should be removed.";
    }
    if (signals.messageReportCount > 1) {
      return `${signals.messageReportCount} reports reference this message. Compare the preview with the report reason.`;
    }
    return "Single reported community message. Review the preview and room context before deciding.";
  }

  private reviewFocus(input: CommunityModerationAssistInput, signals: ModerationAssistSignals) {
    const focus = new Set<string>();
    if (!input.message || input.message.status !== "visible") focus.add("Confirm whether a message action is still applicable.");
    if (signals.reasonCodes.includes("privacy_language_signal")) focus.add("Check for personal data exposure in the preview.");
    if (signals.reasonCodes.includes("safety_language_signal")) focus.add("Assess harassment, threat, or safety policy concerns.");
    if (signals.reasonCodes.includes("spam_language_signal")) focus.add("Check for spam, scam, or phishing patterns.");
    if (signals.messageReportCount > 1) focus.add("Weigh repeated reports against the visible message preview.");
    if (signals.roomOpenReports > 1) focus.add("Review whether this is part of a broader room-level issue.");
    if (input.room.status !== "active") focus.add("Confirm room status before applying a room action.");
    if (focus.size === 0) focus.add("Compare the report reason with the message preview.");
    focus.add("Apply no action unless the human review confirms it.");
    return [...focus].slice(0, MODERATION_ASSIST_FOCUS_LIMIT);
  }

  private systemInstruction(): string {
    return [
      "You summarize Resonate community moderation reports for a human admin.",
      "Return only JSON matching the provided schema.",
      "Use only the bounded report context in the prompt.",
      "Never recommend automatic enforcement; every action requires human confirmation.",
      "Do not invent user identities, emails, wallet addresses, private listener data, or unprovided thread history.",
      "Use only the provided reason code enum values.",
    ].join("\n");
  }

  private userPrompt(input: CommunityModerationAssistInput, deterministic: CommunityModerationAssist): string {
    return JSON.stringify({
      report: {
        reason: redactForModel(input.reason, 200),
      },
      room: {
        title: redactForModel(input.room.title, 120),
        roomType: input.room.roomType,
        ownerType: input.room.ownerType,
        status: input.room.status,
      },
      message: input.message
        ? {
          bodyPreview: input.message.bodyPreview ? redactForModel(input.message.bodyPreview, 240) : null,
          messageType: input.message.messageType,
          status: input.message.status,
        }
        : null,
      context: {
        roomOpenReports: input.context.roomOpenReports,
        messageReportCount: input.context.messageReportCount,
        roomMembershipsByStatus: input.context.roomMembershipsByStatus,
      },
      deterministicAssist: {
        severity: deterministic.severity,
        likelihood: deterministic.likelihood,
        reasonCodes: deterministic.reasonCodes,
        reviewFocus: deterministic.reviewFocus,
      },
      advisoryBoundary: {
        noAutoEnforcement: true,
        humanAdminMustConfirmActions: true,
      },
    });
  }

  private strategy(): CommunityModerationAssistStrategy {
    const normalized = process.env.COMMUNITY_MODERATION_ASSIST_STRATEGY?.trim().toLowerCase();
    if (normalized === "model-assisted" || normalized === "model_assisted") return "model-assisted";
    return "deterministic";
  }

  private modelName(): string {
    return process.env.COMMUNITY_MODERATION_ASSIST_MODEL?.trim()
      || process.env.VERTEX_AI_MODEL?.trim()
      || "gemini-3-flash-preview";
  }

  private timeoutMs(): number {
    const parsed = Number(process.env.COMMUNITY_MODERATION_ASSIST_TIMEOUT_MS);
    if (!Number.isFinite(parsed)) return DEFAULT_MODEL_TIMEOUT_MS;
    return Math.min(MAX_MODEL_TIMEOUT_MS, Math.max(MIN_MODEL_TIMEOUT_MS, parsed));
  }

  private modelConcurrency(): number {
    const parsed = Number(process.env.COMMUNITY_MODERATION_ASSIST_CONCURRENCY);
    if (!Number.isFinite(parsed)) return DEFAULT_MODEL_CONCURRENCY;
    return Math.min(MAX_MODEL_CONCURRENCY, Math.max(1, Math.floor(parsed)));
  }

  private async withModelSlot<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquireModelSlot();
    try {
      return await operation();
    } finally {
      this.releaseModelSlot();
    }
  }

  private async acquireModelSlot() {
    if (this.activeModelCalls < this.modelConcurrency()) {
      this.activeModelCalls += 1;
      return;
    }
    await new Promise<void>((resolve) => this.modelWaiters.push(resolve));
  }

  private releaseModelSlot() {
    const next = this.modelWaiters.shift();
    if (next) {
      next();
      return;
    }
    this.activeModelCalls = Math.max(0, this.activeModelCalls - 1);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`moderation_assist_timeout_${ms}ms`)), ms);
      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

function parseLevel(value: unknown): CommunityModerationAssistLevel | null {
  return typeof value === "string" && MODERATION_ASSIST_LEVEL_SET.has(value)
    ? value as CommunityModerationAssistLevel
    : null;
}

function safeModelText(value: string, maxLength: number) {
  const sanitized = redactForModel(value, maxLength);
  return sanitized.replace(/[{}[\]<>]/g, "").trim();
}

function redactForModel(value: string, maxLength: number) {
  return previewText(value, maxLength)
    .replace(EMAIL_PATTERN, "[email redacted]")
    .replace(WALLET_ADDRESS_PATTERN, "[wallet redacted]");
}

function previewText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function moderationAssistAdvisory() {
  return {
    noAutoEnforcement: true as const,
    copy: "Advisory only. A human admin must choose and confirm any moderation action.",
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
