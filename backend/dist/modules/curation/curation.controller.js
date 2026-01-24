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
exports.CurationController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const throttler_1 = require("@nestjs/throttler");
const roles_decorator_1 = require("../auth/roles.decorator");
const curation_service_1 = require("./curation.service");
let CurationController = class CurationController {
    curationService;
    constructor(curationService) {
        this.curationService = curationService;
    }
    stake(body) {
        return this.curationService.stake(body);
    }
    getStake(curatorId) {
        return this.curationService.getStake(curatorId);
    }
    report(body) {
        return this.curationService.report(body);
    }
    listReports() {
        return { reports: this.curationService.listReports() };
    }
};
exports.CurationController = CurationController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Post)("stake"),
    (0, roles_decorator_1.Roles)("curator", "admin"),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60 } }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CurationController.prototype, "stake", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Get)("stake/:curatorId"),
    (0, roles_decorator_1.Roles)("curator", "admin"),
    __param(0, (0, common_1.Param)("curatorId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CurationController.prototype, "getStake", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Post)("report"),
    (0, roles_decorator_1.Roles)("curator", "admin"),
    (0, throttler_1.Throttle)({ default: { limit: 15, ttl: 60 } }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CurationController.prototype, "report", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Get)("reports"),
    (0, roles_decorator_1.Roles)("admin"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CurationController.prototype, "listReports", null);
exports.CurationController = CurationController = __decorate([
    (0, common_1.Controller)("curation"),
    __metadata("design:paramtypes", [curation_service_1.CurationService])
], CurationController);
