"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const roles_guard_1 = require("../modules/auth/roles.guard");
describe("roles guard", () => {
    const makeContext = (role) => ({
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
            getRequest: () => ({ user: { role } }),
        }),
    });
    it("allows when no roles required", () => {
        const reflector = {
            getAllAndOverride: () => undefined,
            get: () => undefined,
            getAll: () => [],
            getAllAndMerge: () => [],
        };
        const guard = new roles_guard_1.RolesGuard(reflector);
        expect(guard.canActivate(makeContext("listener"))).toBe(true);
    });
    it("blocks when role not allowed", () => {
        const reflector = {
            getAllAndOverride: () => ["admin"],
            get: () => undefined,
            getAll: () => [],
            getAllAndMerge: () => [],
        };
        const guard = new roles_guard_1.RolesGuard(reflector);
        expect(guard.canActivate(makeContext("curator"))).toBe(false);
    });
    it("allows when role matches", () => {
        const reflector = {
            getAllAndOverride: () => ["curator", "admin"],
            get: () => undefined,
            getAll: () => [],
            getAllAndMerge: () => [],
        };
        const guard = new roles_guard_1.RolesGuard(reflector);
        expect(guard.canActivate(makeContext("curator"))).toBe(true);
    });
});
