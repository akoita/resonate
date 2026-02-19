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
const agent_wallet_service_1 = require("../agents/agent_wallet.service");
const agent_purchase_service_1 = require("../agents/agent_purchase.service");
let WalletController = class WalletController {
    walletService;
    sessionKeyService;
    recoveryService;
    agentWalletService;
    agentPurchaseService;
    constructor(walletService, sessionKeyService, recoveryService, agentWalletService, agentPurchaseService) {
        this.walletService = walletService;
        this.sessionKeyService = sessionKeyService;
        this.recoveryService = recoveryService;
        this.agentWalletService = agentWalletService;
        this.agentPurchaseService = agentPurchaseService;
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
    // ============ Agent Wallet Endpoints ============
    enableAgentWallet(req) {
        return this.agentWalletService.enable(req.user.userId);
    }
    registerSessionKey(req, body) {
        return this.agentWalletService.registerSessionKey(req.user.userId, body.serializedKey, body.permissions, new Date(body.validUntil), body.txHash);
    }
    disableAgentWallet(req, body) {
        return this.agentWalletService.disable(req.user.userId, body?.revokeTxHash);
    }
    getAgentWalletStatus(req) {
        return this.agentWalletService.getStatus(req.user.userId);
    }
    getAgentTransactions(req) {
        return this.agentPurchaseService.getTransactions(req.user.userId);
    }
    agentPurchase(req, body) {
        return this.agentPurchaseService.purchase({
            sessionId: body.sessionId,
            userId: req.user.userId,
            listingId: BigInt(body.listingId),
            tokenId: BigInt(body.tokenId),
            amount: BigInt(body.amount),
            totalPriceWei: body.totalPriceWei,
            priceUsd: body.priceUsd,
        });
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
__decorate([
    (0, common_1.Post)("agent/enable"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "enableAgentWallet", null);
__decorate([
    (0, common_1.Post)("agent/session-key/register"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "registerSessionKey", null);
__decorate([
    (0, common_1.Delete)("agent/session-key"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "disableAgentWallet", null);
__decorate([
    (0, common_1.Get)("agent/status"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "getAgentWalletStatus", null);
__decorate([
    (0, common_1.Get)("agent/transactions"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "getAgentTransactions", null);
__decorate([
    (0, common_1.Post)("agent/purchase"),
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WalletController.prototype, "agentPurchase", null);
exports.WalletController = WalletController = __decorate([
    (0, common_1.Controller)("wallet"),
    __param(3, (0, common_1.Inject)((0, common_1.forwardRef)(() => agent_wallet_service_1.AgentWalletService))),
    __param(4, (0, common_1.Inject)((0, common_1.forwardRef)(() => agent_purchase_service_1.AgentPurchaseService))),
    __metadata("design:paramtypes", [wallet_service_1.WalletService,
        session_key_service_1.SessionKeyService,
        social_recovery_service_1.SocialRecoveryService,
        agent_wallet_service_1.AgentWalletService,
        agent_purchase_service_1.AgentPurchaseService])
], WalletController);
