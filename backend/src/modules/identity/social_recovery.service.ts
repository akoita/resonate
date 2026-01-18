import { Injectable } from "@nestjs/common";

interface GuardianRecord {
  userId: string;
  guardians: string[];
}

interface RecoveryRequest {
  requestId: string;
  userId: string;
  newOwner: string;
  approvals: Set<string>;
  required: number;
}

@Injectable()
export class SocialRecoveryService {
  private guardians = new Map<string, GuardianRecord>();
  private recoveries = new Map<string, RecoveryRequest>();

  setGuardians(userId: string, guardians: string[], required: number) {
    if (required > guardians.length) {
      return { status: "invalid_threshold" };
    }
    this.guardians.set(userId, { userId, guardians });
    return { status: "ok", userId, guardians, required };
  }

  requestRecovery(input: { userId: string; newOwner: string; required: number }) {
    const record = this.guardians.get(input.userId);
    if (!record) {
      return { status: "no_guardians" };
    }
    const requestId = `rec_${Date.now()}`;
    this.recoveries.set(requestId, {
      requestId,
      userId: input.userId,
      newOwner: input.newOwner,
      approvals: new Set(),
      required: input.required,
    });
    return { status: "requested", requestId };
  }

  approveRecovery(input: { requestId: string; guardian: string }) {
    const recovery = this.recoveries.get(input.requestId);
    if (!recovery) {
      return { status: "not_found" };
    }
    recovery.approvals.add(input.guardian);
    const approved = recovery.approvals.size >= recovery.required;
    return { status: approved ? "approved" : "pending", approvals: recovery.approvals.size };
  }
}
