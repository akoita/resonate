"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const social_recovery_service_1 = require("../modules/identity/social_recovery.service");
describe("social recovery", () => {
    it("approves recovery when threshold met", () => {
        const service = new social_recovery_service_1.SocialRecoveryService();
        service.setGuardians("user-1", ["g1", "g2"], 2);
        const request = service.requestRecovery({
            userId: "user-1",
            newOwner: "owner-2",
            required: 2,
        });
        expect(request.status).toBe("requested");
        service.approveRecovery({ requestId: request.requestId, guardian: "g1" });
        const approved = service.approveRecovery({
            requestId: request.requestId,
            guardian: "g2",
        });
        expect(approved.status).toBe("approved");
    });
});
