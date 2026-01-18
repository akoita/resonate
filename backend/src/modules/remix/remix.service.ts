import { Injectable } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";

interface RemixRecord {
  remixId: string;
  creatorId: string;
  sourceTrackId: string;
  stemIds: string[];
  title: string;
  status: "submitted" | "minted" | "failed";
  txHash?: string;
}

@Injectable()
export class RemixService {
  private remixes = new Map<string, RemixRecord>();

  constructor(private readonly eventBus: EventBus) {}

  createRemix(input: {
    creatorId: string;
    sourceTrackId: string;
    stemIds: string[];
    title: string;
  }) {
    const remixId = this.generateId("rmx");
    const record: RemixRecord = {
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

  getRemix(remixId: string) {
    return this.remixes.get(remixId) ?? null;
  }

  private generateId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }
}
