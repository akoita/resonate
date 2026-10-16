import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { AdminUsersController } from "../modules/admin_users/admin_users.controller";
import { AdminUsersService } from "../modules/admin_users/admin_users.service";
import { RolesGuard } from "../modules/auth/roles.guard";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockUsers = {
  overview: jest.fn().mockResolvedValue({ totalUsers: 0 }),
  list: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 }),
  detail: jest.fn().mockResolvedValue({ id: "user-2" }),
};

describe("AdminUsersController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(
      [AdminUsersController],
      [{ provide: AdminUsersService, useValue: mockUsers }, RolesGuard],
    );
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  const server = () => app.getHttpServer();
  const bearer = (userId: string, role: string) => ({ Authorization: `Bearer ${authToken(userId, role)}` });

  const routes = ["/admin/users/overview", "/admin/users", "/admin/users/user-2"];

  it.each(routes)("GET %s requires a JWT (401)", async (path) => {
    await request(server()).get(path).expect(401);
    expect(mockUsers.overview).not.toHaveBeenCalled();
    expect(mockUsers.list).not.toHaveBeenCalled();
    expect(mockUsers.detail).not.toHaveBeenCalled();
  });

  it.each(["listener", "artist", "curator", "agent"])(
    "rejects the %s role on every route (403)",
    async (role) => {
      for (const path of routes) {
        await request(server()).get(path).set(bearer("u-1", role)).expect(403);
      }
      expect(mockUsers.overview).not.toHaveBeenCalled();
      expect(mockUsers.list).not.toHaveBeenCalled();
      expect(mockUsers.detail).not.toHaveBeenCalled();
    },
  );

  it.each(["admin", "operator"])("lets the %s role read all three routes", async (role) => {
    const headers = bearer(`${role}-1`, role);
    await request(server()).get("/admin/users/overview").set(headers).expect(200);
    await request(server()).get("/admin/users").set(headers).expect(200);
    await request(server()).get("/admin/users/user-2").set(headers).expect(200);
    expect(mockUsers.overview).toHaveBeenCalledTimes(1);
    expect(mockUsers.list).toHaveBeenCalledTimes(1);
    // The acting user, not a client-supplied value, is what the audit event names.
    expect(mockUsers.detail).toHaveBeenCalledWith(`${role}-1`, "user-2");
  });

  it("does not read `overview` as a user id", async () => {
    await request(server()).get("/admin/users/overview").set(bearer("a-1", "admin")).expect(200);
    expect(mockUsers.detail).not.toHaveBeenCalled();
  });

  it("passes the query through to the service", async () => {
    await request(server())
      .get("/admin/users?q=%20abc%20&status=suspended&role=artist&activeWithinDays=7&sort=lastActiveAt&order=asc&page=2&pageSize=50")
      .set(bearer("a-1", "operator"))
      .expect(200);
    expect(mockUsers.list).toHaveBeenCalledWith(
      expect.objectContaining({
        q: " abc ",
        status: "suspended",
        role: "artist",
        activeWithinDays: "7",
        sort: "lastActiveAt",
        order: "asc",
        page: "2",
        pageSize: "50",
      }),
    );
  });

  describe("query validation (400)", () => {
    const admin = bearer("a-1", "admin");
    it.each([
      "pageSize=0",
      "pageSize=101",
      "pageSize=abc",
      "page=0",
      "page=1.5",
      "sort=email",
      "order=sideways",
      "role=superuser",
      "role=curator",
      "status=banned",
      "activeWithinDays=0",
      "activeWithinDays=366",
      "inactiveForDays=0",
      "inactiveForDays=-3",
      "q=a",
      `q=${"x".repeat(101)}`,
      "q=%20%20a%20%20",
    ])("rejects ?%s", async (queryString) => {
      await request(server()).get(`/admin/users?${queryString}`).set(admin).expect(400);
      expect(mockUsers.list).not.toHaveBeenCalled();
    });

    it.each([
      "pageSize=1",
      "pageSize=100",
      "activeWithinDays=365",
      "inactiveForDays=1",
      "status=active",
      "status=closed",
      "role=listener",
      "role=admin",
      "role=operator",
      "role=agent",
      "sort=createdAt",
      "sort=lastSignInAt",
      "order=desc",
      "q=ab",
    ])("accepts ?%s", async (queryString) => {
      await request(server()).get(`/admin/users?${queryString}`).set(admin).expect(200);
    });
  });
});
