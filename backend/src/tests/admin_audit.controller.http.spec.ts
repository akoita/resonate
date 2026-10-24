import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { AdminAuditController } from "../modules/admin_audit/admin_audit.controller";
import { AdminAuditService } from "../modules/admin_audit/admin_audit.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const page = { items: [], page: 1, pageSize: 50, total: 0 };
const mockAudit = { list: jest.fn().mockResolvedValue(page) };

describe("AdminAuditController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(AdminAuditController, [
      { provide: AdminAuditService, useValue: mockAudit },
      RolesGuard,
    ]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  const server = () => app.getHttpServer();
  const bearer = (userId: string, role: string) => ({ Authorization: `Bearer ${authToken(userId, role)}` });

  it("requires a JWT (401)", async () => {
    await request(server()).get("/admin/audit-events").expect(401);
  });

  it.each(["listener", "artist", "curator", "agent", "operator"])("rejects the %s role (403)", async (role) => {
    await request(server()).get("/admin/audit-events").set(bearer("u-1", role)).expect(403);
    expect(mockAudit.list).not.toHaveBeenCalled();
  });

  it("serves an admin and passes the filters through", async () => {
    const res = await request(server())
      .get("/admin/audit-events")
      .query({ action: "account.closed", outcome: "success", actor: "admin-1", target: "user-2", page: "2", pageSize: "25" })
      .set(bearer("admin-1", "admin"))
      .expect(200);
    expect(res.body).toEqual(page);
    expect(mockAudit.list).toHaveBeenCalledWith(
      expect.objectContaining({ action: "account.closed", outcome: "success", actor: "admin-1", target: "user-2" }),
    );
  });

  it("has no write routes", async () => {
    for (const method of ["post", "put", "patch", "delete"] as const) {
      await (request(server()) as any)[method]("/admin/audit-events").set(bearer("admin-1", "admin")).send({}).expect(404);
    }
  });

  describe("validation (400)", () => {
    it.each([
      ["an unknown action", { action: "account.deleted" }],
      ["an unknown outcome", { outcome: "maybe" }],
      ["a bad date", { from: "yesterday" }],
      ["a page of 0", { page: "0" }],
      ["a page size over the cap", { pageSize: "101" }],
      ["a non-numeric page", { page: "first" }],
    ])("rejects %s", async (_label, query) => {
      await request(server()).get("/admin/audit-events").query(query).set(bearer("admin-1", "admin")).expect(400);
      expect(mockAudit.list).not.toHaveBeenCalled();
    });
  });
});
