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
exports.CatalogController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const catalog_service_1 = require("./catalog.service");
let CatalogController = class CatalogController {
    constructor(catalogService) {
        this.catalogService = catalogService;
    }
    create(body) {
        return this.catalogService.createTrack(body);
    }
    getTrack(trackId) {
        return this.catalogService.getTrack(trackId);
    }
    updateTrack(trackId, body) {
        return this.catalogService.updateTrack(trackId, body);
    }
    listByArtist(artistId) {
        return this.catalogService.listByArtist(artistId);
    }
    listPublished(limit) {
        const parsedLimit = limit ? Number(limit) : 20;
        return this.catalogService.listPublished(Number.isNaN(parsedLimit) ? 20 : parsedLimit);
    }
    search(query, stemType, hasIpnft, limit) {
        const parsedHasIpnft = hasIpnft === undefined ? undefined : hasIpnft === "true";
        const parsedLimit = limit ? Number(limit) : 50;
        return this.catalogService.search(query ?? "", {
            stemType,
            hasIpnft: parsedHasIpnft,
            limit: Number.isNaN(parsedLimit) ? 50 : parsedLimit,
        });
    }
};
exports.CatalogController = CatalogController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "create", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Get)(":trackId"),
    __param(0, (0, common_1.Param)("trackId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "getTrack", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Patch)(":trackId"),
    __param(0, (0, common_1.Param)("trackId")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "updateTrack", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Get)("artist/:artistId"),
    __param(0, (0, common_1.Param)("artistId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "listByArtist", null);
__decorate([
    (0, common_1.Get)("published"),
    __param(0, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "listPublished", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)("q")),
    __param(1, (0, common_1.Query)("stemType")),
    __param(2, (0, common_1.Query)("hasIpnft")),
    __param(3, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "search", null);
exports.CatalogController = CatalogController = __decorate([
    (0, common_1.Controller)("catalog"),
    __metadata("design:paramtypes", [catalog_service_1.CatalogService])
], CatalogController);
