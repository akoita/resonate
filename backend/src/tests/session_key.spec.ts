import { SessionKeyService } from "../modules/identity/session_key.service";

describe("session keys", () => {
  it("issues and validates session keys", () => {
    const service = new SessionKeyService();
    const issued = service.issue({ userId: "user-1", scope: "playback", ttlSeconds: 10 });
    const validated = service.validate(issued.token, "playback");
    expect(validated.valid).toBe(true);
  });
});
