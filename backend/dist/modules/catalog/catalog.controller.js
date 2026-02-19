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
const platform_express_1 = require("@nestjs/platform-express");
const catalog_service_1 = require("./catalog.service");
let CatalogController = class CatalogController {
    catalogService;
    constructor(catalogService) {
        this.catalogService = catalogService;
    }
    async getReleaseArtwork(releaseId, res) {
        const artwork = await this.catalogService.getReleaseArtwork(releaseId);
        if (!artwork) {
            res.status(404).send("Artwork not found");
            return;
        }
        res.set({
            "Content-Type": artwork.mimeType,
            "Cache-Control": "public, max-age=31536000",
        });
        return new common_1.StreamableFile(artwork.data);
    }
    async getStemBlob(stemId, range, res) {
        const stem = await this.catalogService.getStemBlob(stemId);
        if (!stem) {
            res.status(404).send("Stem data not found");
            return;
        }
        const fileSize = stem.data.length;
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            if (start >= fileSize) {
                res.status(416).set({
                    'Content-Range': `bytes */${fileSize}`,
                }).send();
                return;
            }
            const chunksize = (end - start) + 1;
            const file = stem.data.subarray(start, end + 1);
            res.status(206).set({
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': stem.mimeType || 'audio/mpeg',
                'Cache-Control': 'public, max-age=31536000',
            });
            res.end(file);
            return;
        }
        res.set({
            'Content-Length': fileSize,
            'Content-Type': stem.mimeType || 'audio/mpeg',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000',
        });
        res.end(stem.data);
    }
    async getStemPreview(stemId, res) {
        const stem = await this.catalogService.getStemPreview(stemId);
        res.set({
            'Content-Length': stem.data.length,
            'Content-Type': stem.mimeType || 'audio/mpeg',
            'Accept-Ranges': 'none', // Previews might be easier as full downloads for now or small chunks
            'Cache-Control': 'public, max-age=3600',
        });
        res.end(stem.data);
    }
    listMe(req) {
        return this.catalogService.listByUserId(req.user.userId);
    }
    create(req, body) {
        return this.catalogService.createRelease({
            ...body,
            userId: req.user.userId,
        });
    }
    listPublished(limit) {
        console.log(`[Catalog] Fetching published releases (limit: ${limit})`);
        const parsedLimit = limit ? Number(limit) : 20;
        return this.catalogService.listPublished(Number.isNaN(parsedLimit) ? 20 : parsedLimit);
    }
    getRelease(releaseId) {
        return this.catalogService.getRelease(releaseId);
    }
    getTrack(trackId) {
        return this.catalogService.getTrack(trackId);
    }
    updateRelease(releaseId, body) {
        return this.catalogService.updateRelease(releaseId, body);
    }
    deleteRelease(releaseId, req) {
        return this.catalogService.deleteRelease(releaseId, req.user.userId);
    }
    async updateArtwork(releaseId, files, req) {
        const artwork = files.artwork?.[0];
        if (!artwork)
            throw new common_1.BadRequestException("No artwork file provided");
        return this.catalogService.updateReleaseArtwork(releaseId, req.user.userId, {
            buffer: artwork.buffer,
            mimetype: artwork.mimetype
        });
    }
    listByArtist(artistId) {
        return this.catalogService.listByArtist(artistId);
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
    (0, common_1.Get)("releases/:releaseId/artwork"),
    __param(0, (0, common_1.Param)("releaseId")),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], CatalogController.prototype, "getReleaseArtwork", null);
__decorate([
    (0, common_1.Get)("stems/:stemId/blob"),
    __param(0, (0, common_1.Param)("stemId")),
    __param(1, (0, common_1.Headers)("range")),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], CatalogController.prototype, "getStemBlob", null);
__decorate([
    (0, common_1.Get)("stems/:stemId/preview"),
    __param(0, (0, common_1.Param)("stemId")),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], CatalogController.prototype, "getStemPreview", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Get)("me"),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "listMe", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Post)(),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "create", null);
__decorate([
    (0, common_1.Get)("published"),
    __param(0, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "listPublished", null);
__decorate([
    (0, common_1.Get)("releases/:releaseId"),
    __param(0, (0, common_1.Param)("releaseId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "getRelease", null);
__decorate([
    (0, common_1.Get)("tracks/:trackId"),
    __param(0, (0, common_1.Param)("trackId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "getTrack", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Patch)("releases/:releaseId"),
    __param(0, (0, common_1.Param)("releaseId")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "updateRelease", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Delete)("releases/:releaseId"),
    __param(0, (0, common_1.Param)("releaseId")),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "deleteRelease", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Patch)("releases/:releaseId/artwork"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileFieldsInterceptor)([{ name: 'artwork', maxCount: 1 }])),
    __param(0, (0, common_1.Param)("releaseId")),
    __param(1, (0, common_1.UploadedFiles)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], CatalogController.prototype, "updateArtwork", null);
__decorate([
    (0, common_1.Get)("artist/:artistId"),
    __param(0, (0, common_1.Param)("artistId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "listByArtist", null);
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
