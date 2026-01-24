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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const audit_service_1 = require("../audit/audit.service");
let AuthService = class AuthService {
    jwtService;
    auditService;
    constructor(jwtService, auditService) {
        this.jwtService = jwtService;
        this.auditService = auditService;
    }
    issueToken(userId, role = "listener") {
        const allowedRole = this.resolveRole(userId, role);
        const token = this.jwtService.sign({ sub: userId, role: allowedRole });
        this.auditService.log({
            action: "auth.login",
            actorId: userId,
            resource: "auth",
            metadata: { role: allowedRole },
        });
        return { accessToken: token };
    }
    issueTokenForAddress(address, role = "listener") {
        return this.issueToken(address.toLowerCase(), role);
    }
    resolveRole(userId, role) {
        if (role !== "admin") {
            return role;
        }
        const allowList = (process.env.ADMIN_ADDRESSES ?? "")
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean);
        if (allowList.includes(userId.toLowerCase())) {
            return "admin";
        }
        return "listener";
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        audit_service_1.AuditService])
], AuthService);
