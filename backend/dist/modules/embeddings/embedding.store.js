"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddingStore = void 0;
const common_1 = require("@nestjs/common");
let EmbeddingStore = class EmbeddingStore {
    constructor() {
        this.embeddings = new Map();
    }
    upsert(trackId, vector) {
        this.embeddings.set(trackId, vector);
    }
    get(trackId) {
        return this.embeddings.get(trackId) ?? null;
    }
    similarity(query, candidates) {
        const scored = candidates
            .map((trackId) => {
            const vector = this.embeddings.get(trackId);
            if (!vector) {
                return null;
            }
            return { trackId, score: this.cosine(query, vector) };
        })
            .filter(Boolean);
        return scored.sort((a, b) => b.score - a.score);
    }
    cosine(a, b) {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i += 1) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (!normA || !normB) {
            return 0;
        }
        return dot / Math.sqrt(normA * normB);
    }
};
exports.EmbeddingStore = EmbeddingStore;
exports.EmbeddingStore = EmbeddingStore = __decorate([
    (0, common_1.Injectable)()
], EmbeddingStore);
