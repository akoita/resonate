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
exports.CurationService = void 0;
const common_1 = require("@nestjs/common");
const audit_service_1 = require("../audit/audit.service");
const event_bus_1 = require("../shared/event_bus");
let CurationService = class CurationService {
    eventBus;
    audit;
    stakes = new Map();
    reports = [];
    constructor(eventBus, audit) {
        this.eventBus = eventBus;
        this.audit = audit;
    }
    stake(input) {
        const record = {
            curatorId: input.curatorId,
            amountUsd: input.amountUsd,
            updatedAt: new Date().toISOString(),
        };
        this.stakes.set(input.curatorId, record);
        this.eventBus.publish({
            eventName: "curator.staked",
            eventVersion: 1,
            occurredAt: record.updatedAt,
            curatorId: input.curatorId,
            amountUsd: input.amountUsd,
        });
        this.audit.log({
            action: "curator.staked",
            actorId: input.curatorId,
            resource: "curation",
            metadata: { amountUsd: input.amountUsd },
        });
        return record;
    }
    getStake(curatorId) {
        return this.stakes.get(curatorId) ?? null;
    }
    report(input) {
        const report = {
            reportId: this.generateId("rpt"),
            curatorId: input.curatorId,
            trackId: input.trackId,
            reason: input.reason,
            status: "submitted",
            createdAt: new Date().toISOString(),
        };
        this.reports.push(report);
        this.eventBus.publish({
            eventName: "curator.reported",
            eventVersion: 1,
            occurredAt: report.createdAt,
            reportId: report.reportId,
            curatorId: input.curatorId,
            trackId: input.trackId,
            reason: input.reason,
        });
        this.audit.log({
            action: "curator.reported",
            actorId: input.curatorId,
            resource: `track:${input.trackId}`,
            metadata: { reason: input.reason },
        });
        return report;
    }
    listReports() {
        return this.reports.slice();
    }
    generateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    }
};
exports.CurationService = CurationService;
exports.CurationService = CurationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus, audit_service_1.AuditService])
], CurationService);
