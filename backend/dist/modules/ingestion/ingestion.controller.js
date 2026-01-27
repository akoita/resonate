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
exports.IngestionController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const passport_1 = require("@nestjs/passport");
const throttler_1 = require("@nestjs/throttler");
const ingestion_service_1 = require("./ingestion.service");
let IngestionController = class IngestionController {
    ingestionService;
    constructor(ingestionService) {
        this.ingestionService = ingestionService;
    }
    upload(files, body) {
        const metadata = body.metadata ? JSON.parse(body.metadata) : undefined;
        return this.ingestionService.handleFileUpload({
            artistId: body.artistId,
            files: files.files || [],
            artwork: files.artwork?.[0],
            metadata,
        });
    }
    status(trackId) {
        return this.ingestionService.getStatus(trackId);
    }
};
exports.IngestionController = IngestionController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Post)("upload"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileFieldsInterceptor)([
        { name: 'files', maxCount: 20 },
        { name: 'artwork', maxCount: 1 },
    ])),
    (0, throttler_1.Throttle)({ default: { limit: 20, ttl: 60 } }),
    __param(0, (0, common_1.UploadedFiles)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], IngestionController.prototype, "upload", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Get)("status/:trackId"),
    __param(0, (0, common_1.Param)("trackId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], IngestionController.prototype, "status", null);
exports.IngestionController = IngestionController = __decorate([
    (0, common_1.Controller)("stems"),
    __metadata("design:paramtypes", [ingestion_service_1.IngestionService])
], IngestionController);
