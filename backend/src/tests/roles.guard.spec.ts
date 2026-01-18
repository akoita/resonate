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

  it("allows when no roles required", () => {
    const reflector = {
      getAllAndOverride: () => undefined,
      get: () => undefined,
      getAll: () => [],
      getAllAndMerge: () => [],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext("listener"))).toBe(true);
  });

  it("blocks when role not allowed", () => {
    const reflector = {
      getAllAndOverride: () => ["admin"],
      get: () => undefined,
      getAll: () => [],
      getAllAndMerge: () => [],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext("curator"))).toBe(false);
  });

  it("allows when role matches", () => {
    const reflector = {
      getAllAndOverride: () => ["curator", "admin"],
      get: () => undefined,
      getAll: () => [],
      getAllAndMerge: () => [],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext("curator"))).toBe(true);
  });
});
