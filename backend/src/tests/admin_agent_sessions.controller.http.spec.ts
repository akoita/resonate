import request from "supertest";
import { BadRequestException, INestApplication, NotFoundException } from "@nestjs/common";
import { AdminAgentSessionsController } from "../modules/admin_agent_sessions/admin_agent_sessions.controller";
import { AdminAgentSessionsService } from "../modules/admin_agent_sessions/admin_agent_sessions.service";
import { RolesGuard } from "../modules/auth/roles.guard";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockSessions = {
  events: jest.fn().mockResolvedValue({ sessionId: "session-1", events: [], eventCount: 0 }),
};

describe("AdminAgentSessionsController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(
      [AdminAgentSessionsController],
      [{ provide: AdminAgentSessionsService, useValue: mockSessions }, RolesGuard],
    );
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  const server = () => app.getHttpServer();
  const bearer = (userId: string, role: string) => ({ Authorization: `Bearer ${authToken(userId, role)}` });
  const route = "/admin/agent-sessions/session-1/events";

  it("requires a JWT (401)", async () => {
    await request(server()).get(route).expect(401);
    expect(mockSessions.events).not.toHaveBeenCalled();
  });

  it.each(["listener", "artist", "curator", "agent", "operator"])(
    "rejects the %s role (403): the view is admin-only",
    async (role) => {
      await request(server()).get(route).set(bearer("u-1", role)).expect(403);
      expect(mockSessions.events).not.toHaveBeenCalled();
    },
  );

  it("lets an admin read, naming the acting admin from the token, not the request", async () => {
    const response = await request(server())
      .get(`${route}?actorUserId=someone-else`)
      .set(bearer("admin-1", "admin"))
      .expect(200);
    expect(response.body.sessionId).toBe("session-1");
    expect(mockSessions.events).toHaveBeenCalledTimes(1);
    expect(mockSessions.events).toHaveBeenCalledWith("admin-1", "session-1");
  });

  it("passes the session id through decoded", async () => {
    await request(server())
      .get("/admin/agent-sessions/a%3Ab/events")
      .set(bearer("admin-1", "admin"))
      .expect(200);
    expect(mockSessions.events).toHaveBeenCalledWith("admin-1", "a:b");
  });

  it("answers 404 and 400 from the service", async () => {
    const admin = bearer("admin-1", "admin");
    mockSessions.events.mockRejectedValueOnce(new NotFoundException("Session not found"));
    await request(server()).get(route).set(admin).expect(404);
    mockSessions.events.mockRejectedValueOnce(new BadRequestException("Invalid session id"));
    await request(server()).get(route).set(admin).expect(400);
  });
});
