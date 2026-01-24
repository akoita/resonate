"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocialRecoveryService = void 0;
const common_1 = require("@nestjs/common");
let SocialRecoveryService = class SocialRecoveryService {
    constructor() {
        this.guardians = new Map();
        this.recoveries = new Map();
    }
    setGuardians(userId, guardians, required) {
        if (required > guardians.length) {
            return { status: "invalid_threshold" };
        }
        this.guardians.set(userId, { userId, guardians });
        return { status: "ok", userId, guardians, required };
    }
    requestRecovery(input) {
        const record = this.guardians.get(input.userId);
        if (!record) {
            return { status: "no_guardians" };
        }
        const requestId = `rec_${Date.now()}`;
        this.recoveries.set(requestId, {
            requestId,
            userId: input.userId,
            newOwner: input.newOwner,
            approvals: new Set(),
            required: input.required,
        });
        return { status: "requested", requestId };
    }
    approveRecovery(input) {
        const recovery = this.recoveries.get(input.requestId);
        if (!recovery) {
            return { status: "not_found" };
        }
        recovery.approvals.add(input.guardian);
        const approved = recovery.approvals.size >= recovery.required;
        return { status: approved ? "approved" : "pending", approvals: recovery.approvals.size };
    }
};
exports.SocialRecoveryService = SocialRecoveryService;
exports.SocialRecoveryService = SocialRecoveryService = __decorate([
    (0, common_1.Injectable)()
], SocialRecoveryService);
