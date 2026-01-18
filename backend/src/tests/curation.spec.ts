import { CurationService } from "../modules/curation/curation.service";
import { AuditService } from "../modules/audit/audit.service";
import { EventBus } from "../modules/shared/event_bus";

describe("curation", () => {
  it("stores curator stake", () => {
    const service = new CurationService(new EventBus(), new AuditService());
    const result = service.stake({ curatorId: "curator-1", amountUsd: 25 });
    expect(result.amountUsd).toBe(25);
    expect(service.getStake("curator-1")?.amountUsd).toBe(25);
  });

  it("records reports", () => {
    const service = new CurationService(new EventBus(), new AuditService());
    const report = service.report({
      curatorId: "curator-1",
      trackId: "track-1",
      reason: "fraud",
    });
    expect(report.reportId).toBeDefined();
    expect(service.listReports().length).toBe(1);
  });
});
