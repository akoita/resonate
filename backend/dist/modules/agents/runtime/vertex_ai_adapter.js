"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var VertexAiAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VertexAiAdapter = void 0;
const common_1 = require("@nestjs/common");
const generative_ai_1 = require("@google/generative-ai");
const tool_registry_1 = require("../tools/tool_registry");
const tool_declarations_1 = require("../tools/tool_declarations");
const MAX_TOOL_ROUNDS = 6;
const TIMEOUT_MS = 30_000;
let VertexAiAdapter = VertexAiAdapter_1 = class VertexAiAdapter {
    tools;
    name = "vertex";
    logger = new common_1.Logger(VertexAiAdapter_1.name);
    constructor(tools) {
        this.tools = tools;
    }
    async run(input) {
        const start = Date.now();
        const apiKey = process.env.GOOGLE_AI_API_KEY;
        if (!apiKey) {
            this.logger.warn("GOOGLE_AI_API_KEY not set — falling back to deterministic orchestrator");
            throw new Error("GOOGLE_AI_API_KEY not configured");
        }
        // Let errors propagate so AgentRuntimeService can fall back to the orchestrator
        return await this.withTimeout(this.callGemini(apiKey, input, start), TIMEOUT_MS, start);
    }
    async callGemini(apiKey, input, startMs) {
        const modelName = process.env.VERTEX_AI_MODEL ?? "gemini-3-flash-preview";
        const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: modelName,
            tools: [{ functionDeclarations: (0, tool_declarations_1.getToolDeclarations)() }],
            systemInstruction: this.buildSystemPrompt(input),
        });
        const chat = model.startChat({ history: [] });
        // Initial user message with session context
        const userMessage = this.buildUserMessage(input);
        let response = await chat.sendMessage(userMessage);
        // Tool calling loop: iterate while model requests function calls
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const candidate = response.response.candidates?.[0];
            if (!candidate)
                break;
            const functionCalls = this.extractFunctionCalls(candidate.content);
            if (functionCalls.length === 0)
                break;
            // Execute each function call and collect results
            const functionResponses = [];
            for (const fc of functionCalls) {
                this.logger.debug(`Tool call: ${fc.name}(${JSON.stringify(fc.args)})`);
                const toolResult = await (0, tool_declarations_1.executeTool)(this.tools, {
                    name: fc.name,
                    args: fc.args,
                });
                functionResponses.push({
                    functionResponse: {
                        name: fc.name,
                        response: toolResult,
                    },
                });
            }
            // Send tool results back to the model
            response = await chat.sendMessage(functionResponses);
        }
        // Extract the final text response
        const text = response.response.text?.() ?? "";
        return this.parseResponse(text, input, Date.now() - startMs);
    }
    extractFunctionCalls(content) {
        if (!content?.parts)
            return [];
        return content.parts
            .filter((p) => !!p.functionCall)
            .map((p) => p.functionCall);
    }
    buildSystemPrompt(input) {
        return [
            "You are a music curation DJ agent for the Resonate platform.",
            "Your job is to find ALL tracks that match the user's taste and genre preferences.",
            "",
            "You have access to tools to search the catalog, check pricing, get analytics, and rank tracks by similarity.",
            "",
            "Guidelines:",
            "- Use catalog_search to find tracks matching EACH of the user's genre/mood preferences.",
            "- Search for each genre separately to get comprehensive results.",
            "- Use pricing_quote to check if tracks fit within the remaining budget.",
            "- STRONGLY PREFER tracks where hasListing is true — these can be purchased on-chain.",
            "- Only recommend tracks without listings if no listed alternatives exist.",
            "- Include EVERY listed track that matches the desired taste.",
            "- Avoid recommending tracks the user has recently listened to.",
            "- Stay within the user's budget.",
            "",
            "After using tools, respond with ALL matching tracks.",
            "List each track on its own line using this exact format:",
            "",
            "TRACK: <trackId> | LICENSE: <personal|remix|commercial> | PRICE: <price in USD>",
            "TRACK: <trackId> | LICENSE: <personal|remix|commercial> | PRICE: <price in USD>",
            "...",
            "",
            "Then on a new line:",
            "REASONING: <1-2 sentence explanation of your overall curation strategy>",
        ].join("\n");
    }
    buildUserMessage(input) {
        const parts = [
            `Session: ${input.sessionId}`,
            `Budget remaining: $${input.budgetRemainingUsd.toFixed(2)}`,
        ];
        if (input.preferences.mood) {
            parts.push(`Mood: ${input.preferences.mood}`);
        }
        if (input.preferences.energy) {
            parts.push(`Energy: ${input.preferences.energy}`);
        }
        if (input.preferences.genres?.length) {
            parts.push(`Genres: ${input.preferences.genres.join(", ")}`);
        }
        if (input.preferences.licenseType) {
            parts.push(`License type: ${input.preferences.licenseType}`);
        }
        if (input.recentTrackIds.length > 0) {
            parts.push(`Recently played (avoid these): ${input.recentTrackIds.join(", ")}`);
        }
        parts.push("", "Please find and recommend the best tracks for me.");
        return parts.join("\n");
    }
    parseResponse(text, input, latencyMs) {
        // Parse multiple TRACK lines: "TRACK: <id> | LICENSE: <type> | PRICE: <price>"
        const trackPattern = /TRACK:\s*(.+?)\s*\|\s*LICENSE:\s*(\w+)\s*\|\s*PRICE:\s*\$?([\d.]+)/gi;
        const picks = [];
        let budgetLeft = input.budgetRemainingUsd;
        let match;
        while ((match = trackPattern.exec(text)) !== null) {
            const trackId = match[1].trim();
            const licenseType = (match[2].trim().toLowerCase());
            const priceUsd = parseFloat(match[3]);
            if (trackId && priceUsd <= budgetLeft) {
                picks.push({ trackId, licenseType, priceUsd });
                budgetLeft -= priceUsd;
            }
        }
        // Fallback: try the old single-line format for backward compatibility
        if (picks.length === 0) {
            const trackMatch = text.match(/TRACK:\s*(.+)/i);
            const licenseMatch = text.match(/LICENSE:\s*(.+)/i);
            const priceMatch = text.match(/PRICE:\s*\$?([\d.]+)/i);
            const trackId = trackMatch?.[1]?.trim();
            if (trackId) {
                const licenseType = (licenseMatch?.[1]?.trim() ?? "personal");
                const priceUsd = priceMatch ? parseFloat(priceMatch[1]) : 0;
                if (priceUsd <= input.budgetRemainingUsd) {
                    picks.push({ trackId, licenseType, priceUsd });
                }
            }
        }
        const reasoningMatch = text.match(/REASONING:\s*(.+)/i);
        const reasoning = reasoningMatch?.[1]?.trim() ?? text.slice(0, 200);
        if (picks.length === 0) {
            return {
                status: "rejected",
                reason: "llm_no_track_selected",
                reasoning: reasoning || "Could not find suitable tracks",
                latencyMs,
            };
        }
        this.logger.log(`LLM selected ${picks.length} track(s) in ${latencyMs}ms`);
        return {
            status: "approved",
            // Keep first pick for backward compatibility
            trackId: picks[0].trackId,
            licenseType: picks[0].licenseType,
            priceUsd: picks[0].priceUsd,
            reason: "vertex_llm",
            reasoning,
            latencyMs,
            picks,
        };
    }
    withTimeout(promise, ms, startMs) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.logger.warn(`Gemini call timed out after ${ms}ms — falling back to deterministic orchestrator`);
                reject(new Error(`Gemini timeout after ${ms}ms`));
            }, ms);
            promise
                .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
                .catch((err) => {
                clearTimeout(timer);
                this.logger.error(`Gemini call error: ${err.message}`);
                reject(err);
            });
        });
    }
};
exports.VertexAiAdapter = VertexAiAdapter;
exports.VertexAiAdapter = VertexAiAdapter = VertexAiAdapter_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tool_registry_1.ToolRegistry])
], VertexAiAdapter);
