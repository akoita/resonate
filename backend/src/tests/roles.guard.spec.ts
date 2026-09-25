import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "../modules/auth/roles.guard";

describe("roles guard", () => {
  const makeContext = (role?: string) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as unknown as ExecutionContext;

  it("allows when no roles required", async () => {
    const reflector = {
      getAllAndOverride: () => undefined,
      get: () => undefined,
      getAll: () => [],
      getAllAndMerge: () => [],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    await expect(guard.canActivate(makeContext("listener"))).resolves.toBe(true);
  });

  it("blocks when role not allowed", async () => {
    const reflector = {
      getAllAndOverride: () => ["admin"],
      get: () => undefined,
      getAll: () => [],
      getAllAndMerge: () => [],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    await expect(guard.canActivate(makeContext("curator"))).resolves.toBe(false);
  });

  it("allows when role matches", async () => {
    const reflector = {
      getAllAndOverride: () => ["curator", "admin"],
      get: () => undefined,
      getAll: () => [],
      getAllAndMerge: () => [],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    await expect(guard.canActivate(makeContext("curator"))).resolves.toBe(true);
  });
});
