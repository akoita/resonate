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
exports.RemixService = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
let RemixService = class RemixService {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.remixes = new Map();
    }
    createRemix(input) {
        const remixId = this.generateId("rmx");
        const record = {
            remixId,
            creatorId: input.creatorId,
            sourceTrackId: input.sourceTrackId,
            stemIds: input.stemIds,
            title: input.title,
            status: "submitted",
            txHash: this.generateId("tx"),
        };
        this.remixes.set(remixId, record);
        this.eventBus.publish({
            eventName: "remix.created",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            remixId,
            creatorId: input.creatorId,
            sourceTrackId: input.sourceTrackId,
            stemIds: input.stemIds,
            title: input.title,
            txHash: record.txHash,
        });
        return record;
    }
    getRemix(remixId) {
        return this.remixes.get(remixId) ?? null;
    }
    generateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    }
};
exports.RemixService = RemixService;
exports.RemixService = RemixService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus])
], RemixService);
