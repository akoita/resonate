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
exports.IngestionService = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
let IngestionService = class IngestionService {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.uploads = new Map();
    }
    enqueueUpload(input) {
        const trackId = this.generateId("trk");
        const record = {
            trackId,
            artistId: input.artistId,
            fileUris: input.fileUris,
            status: "queued",
            metadata: input.metadata,
        };
        this.uploads.set(trackId, record);
        this.eventBus.publish({
            eventName: "stems.uploaded",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            trackId,
            artistId: input.artistId,
            fileUris: input.fileUris,
            checksum: "pending",
            metadata: input.metadata,
        });
        void this.processUpload(trackId);
        return { trackId, status: record.status };
    }
    getStatus(trackId) {
        const record = this.uploads.get(trackId);
        if (!record) {
            return { trackId, status: "failed", error: "Not found" };
        }
        return { trackId, status: record.status, stems: record.stems ?? [] };
    }
    async processUpload(trackId) {
        const record = this.uploads.get(trackId);
        if (!record) {
            return;
        }
        record.status = "processing";
        const stems = record.fileUris.map((uri) => ({
            id: this.generateId("stem"),
            uri,
            type: this.inferStemType(uri),
        }));
        record.stems = stems;
        this.eventBus.publish({
            eventName: "stems.processed",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            trackId: record.trackId,
            stemIds: stems.map((stem) => stem.id),
            modelVersion: "mock-v1",
            durationMs: 0,
            stems,
        });
        record.status = "complete";
    }
    generateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    }
    inferStemType(uri) {
        const normalized = uri.toLowerCase();
        if (normalized.includes("drum")) {
            return "drums";
        }
        if (normalized.includes("vocal")) {
            return "vocals";
        }
        if (normalized.includes("bass")) {
            return "bass";
        }
        return "other";
    }
};
exports.IngestionService = IngestionService;
exports.IngestionService = IngestionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus])
], IngestionService);
