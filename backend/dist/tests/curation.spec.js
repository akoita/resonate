"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const curation_service_1 = require("../modules/curation/curation.service");
const audit_service_1 = require("../modules/audit/audit.service");
const event_bus_1 = require("../modules/shared/event_bus");
describe("curation", () => {
    it("stores curator stake", () => {
        const service = new curation_service_1.CurationService(new event_bus_1.EventBus(), new audit_service_1.AuditService());
        const result = service.stake({ curatorId: "curator-1", amountUsd: 25 });
        expect(result.amountUsd).toBe(25);
        expect(service.getStake("curator-1")?.amountUsd).toBe(25);
    });
    it("records reports", () => {
        const service = new curation_service_1.CurationService(new event_bus_1.EventBus(), new audit_service_1.AuditService());
        const report = service.report({
            curatorId: "curator-1",
            trackId: "track-1",
            reason: "fraud",
        });
        expect(report.reportId).toBeDefined();
        expect(service.listReports().length).toBe(1);
    });
});
