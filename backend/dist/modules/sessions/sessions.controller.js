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
exports.SessionsController = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const sessions_service_1 = require("./sessions.service");
let SessionsController = class SessionsController {
    constructor(sessionsService) {
        this.sessionsService = sessionsService;
    }
    start(body) {
        return this.sessionsService.startSession(body);
    }
    stop(body) {
        return this.sessionsService.stopSession(body.sessionId);
    }
    play(body) {
        return this.sessionsService.playTrack(body);
    }
    agentNext(body) {
        return this.sessionsService.agentNext(body);
    }
    playlist(limit) {
        const parsed = limit ? Number(limit) : 10;
        return this.sessionsService.getPlaylist(Number.isNaN(parsed) ? 10 : parsed);
    }
};
exports.SessionsController = SessionsController;
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Post)("start"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "start", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Post)("stop"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "stop", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Post)("play"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "play", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Post)("agent/next"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "agentNext", null);
__decorate([
    (0, common_1.UseGuards)((0, passport_1.AuthGuard)("jwt")),
    (0, common_1.Get)("playlist"),
    __param(0, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "playlist", null);
exports.SessionsController = SessionsController = __decorate([
    (0, common_1.Controller)("sessions"),
    __metadata("design:paramtypes", [sessions_service_1.SessionsService])
], SessionsController);
