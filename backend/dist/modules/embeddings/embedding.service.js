"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddingService = void 0;
const common_1 = require("@nestjs/common");
let EmbeddingService = class EmbeddingService {
    dimension = 16;
    embed(text) {
        const vector = new Array(this.dimension).fill(0);
        const tokens = text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean);
        if (tokens.length === 0) {
            return vector;
        }
        tokens.forEach((token) => {
            const hash = this.hash(token);
            const index = hash % this.dimension;
            vector[index] += 1;
        });
        const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
        return vector.map((val) => val / norm);
    }
    hash(value) {
        let hash = 0;
        for (let i = 0; i < value.length; i += 1) {
            hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
        }
        return hash;
    }
};
exports.EmbeddingService = EmbeddingService;
exports.EmbeddingService = EmbeddingService = __decorate([
    (0, common_1.Injectable)()
], EmbeddingService);
