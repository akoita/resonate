import { Injectable } from "@nestjs/common";

interface AuditRecord {
  action: string;
  actorId: string;
  resource?: string;
  metadata?: Record<string, unknown>;
  occurredAt: string;
}

@Injectable()
export class AuditService {
  private records: AuditRecord[] = [];

  log(record: Omit<AuditRecord, "occurredAt">) {
    const entry: AuditRecord = { ...record, occurredAt: new Date().toISOString() };
    this.records.push(entry);
    console.info(JSON.stringify({ level: "info", message: "audit", ...entry }));
  }

  list() {
    return this.records.slice();
  }
}
