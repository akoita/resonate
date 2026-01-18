import { Injectable } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";

interface StakeRecord {
  curatorId: string;
  amountUsd: number;
  updatedAt: string;
}

interface ReportRecord {
  reportId: string;
  curatorId: string;
  trackId: string;
  reason: string;
  status: "submitted" | "reviewed";
  createdAt: string;
}

@Injectable()
export class CurationService {
  private stakes = new Map<string, StakeRecord>();
  private reports: ReportRecord[] = [];

  constructor(private readonly eventBus: EventBus) {}

  stake(input: { curatorId: string; amountUsd: number }) {
    const record: StakeRecord = {
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
    return record;
  }

  getStake(curatorId: string) {
    return this.stakes.get(curatorId) ?? null;
  }

  report(input: { curatorId: string; trackId: string; reason: string }) {
    const report: ReportRecord = {
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
    return report;
  }

  listReports() {
    return this.reports.slice();
  }

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }
}
