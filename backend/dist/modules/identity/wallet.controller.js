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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const roles_decorator_1 = require("../auth/roles.decorator");
const session_key_service_1 = require("./session_key.service");
const social_recovery_service_1 = require("./social_recovery.service");
const wallet_service_1 = require("./wallet.service");
let WalletController = class WalletController {
    constructor(walletService, sessionKeyService, recoveryService) {
        this.walletService = walletService;
        this.sessionKeyService = sessionKeyService;
        this.recoveryService = recoveryService;
    }
    fund(body) {
        return this.walletService.fundWallet(body);
    }
    setBudget(body) {
        return this.walletService.setBudget(body);
    }
    setProvider(body) {
        return this.walletService.setProvider(body);
    }
    refresh(body) {
        return this.walletService.refreshWallet(body);
    }
    deploy(body) {
        return this.walletService.deploySmartAccount(body);
    }
    enableSmartAccount(req) {
        return this.walletService.setProvider({ userId: req.user.userId, provider: "erc4337" });
    }
    refreshSmartAccount(req) {
        return this.walletService.refreshWallet({ userId: req.user.userId, provider: "erc4337" });
    }
    deploySmartAccountForUser(req) {
        return this.walletService.deploySmartAccount({ userId: req.user.userId });
    }
    configurePaymaster(body) {
        this.walletService.configurePaymaster(body);
        return { status: "ok" };
    }
    getPaymasterStatus(req) {
        return this.walletService.getPaymasterStatus(req.query?.userId);
    }
    resetPaymaster(body) {
        this.walletService.resetPaymaster(body.userId);
        return { status: "ok" };
    }
    get(userId) {
        return this.walletService.getWallet(userId);
    }
    createSessionKey(body) {
        return this.sessionKeyService.issue(body);
    }
    validateSessionKey(body) {
        return this.sessionKeyService.validate(body.token, body.scope);
    }
    setGuardians(body) {
        return this.recoveryService.setGuardians(body.userId, body.guardians, body.required);
    }
    requestRecovery(body) {
        return this.recoveryService.requestRecovery(body);
    }
    approveRecovery(body) {
        return this.recoveryService.approveRecovery(body);
    }
};
exports.WalletController = WalletController;
__decorate([
    (0, common_1.Post)("fund"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "fund", null);
__decorate([
    (0, common_1.Post)("budget"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "setBudget", null);
__decorate([
    (0, common_1.Post)("provider"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "setProvider", null);
__decorate([
    (0, common_1.Post)("refresh"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)("deploy"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "deploy", null);
__decorate([
    (0, common_1.Post)("aa/enable"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "enableSmartAccount", null);
__decorate([
    (0, common_1.Post)("aa/refresh"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "refreshSmartAccount", null);
__decorate([
    (0, common_1.Post)("aa/deploy"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "deploySmartAccountForUser", null);
__decorate([
    (0, common_1.Post)("paymaster"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "configurePaymaster", null);
__decorate([
    (0, common_1.Get)("paymaster"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "getPaymasterStatus", null);
__decorate([
    (0, common_1.Post)("paymaster/reset"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "resetPaymaster", null);
__decorate([
    (0, common_1.Get)(":userId"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Param)("userId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "get", null);
__decorate([
    (0, common_1.Post)("session-key"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "createSessionKey", null);
__decorate([
    (0, common_1.Post)("session-key/validate"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "validateSessionKey", null);
__decorate([
    (0, common_1.Post)("guardians"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "setGuardians", null);
__decorate([
    (0, common_1.Post)("recovery/request"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "requestRecovery", null);
__decorate([
    (0, common_1.Post)("recovery/approve"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, roles_decorator_1.Roles)("admin"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "approveRecovery", null);
exports.WalletController = WalletController = __decorate([
    (0, common_1.Controller)("wallet"),
    __metadata("design:paramtypes", [wallet_service_1.WalletService,
        session_key_service_1.SessionKeyService,
        social_recovery_service_1.SocialRecoveryService])
], WalletController);
