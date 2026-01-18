import { SocialRecoveryService } from "../modules/identity/social_recovery.service";

describe("social recovery", () => {
  it("approves recovery when threshold met", () => {
    const service = new SocialRecoveryService();
    service.setGuardians("user-1", ["g1", "g2"], 2);
    const request = service.requestRecovery({
      userId: "user-1",
      newOwner: "owner-2",
      required: 2,
    });
    expect(request.status).toBe("requested");
    service.approveRecovery({ requestId: request.requestId as string, guardian: "g1" });
    const approved = service.approveRecovery({
      requestId: request.requestId as string,
      guardian: "g2",
    });
    expect(approved.status).toBe("approved");
  });
});
