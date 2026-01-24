"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionKeyService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
let SessionKeyService = class SessionKeyService {
    keys = new Map();
    issue(input) {
        const token = `sk_${(0, crypto_1.randomUUID)()}`;
        const record = {
            token,
            userId: input.userId,
            scope: input.scope,
            expiresAt: Date.now() + input.ttlSeconds * 1000,
        };
        this.keys.set(token, record);
        return record;
    }
    validate(token, scope) {
        const record = this.keys.get(token);
        if (!record) {
            return { valid: false, reason: "not_found" };
        }
        if (record.expiresAt < Date.now()) {
            return { valid: false, reason: "expired" };
        }
        if (record.scope !== scope) {
            return { valid: false, reason: "scope_mismatch" };
        }
        return { valid: true, userId: record.userId };
    }
};
exports.SessionKeyService = SessionKeyService;
exports.SessionKeyService = SessionKeyService = __decorate([
    (0, common_1.Injectable)()
], SessionKeyService);
