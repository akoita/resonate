/**
 * Bounded "last active" tracking (#2166) against real Postgres: at most one
 * write per person per hour, whichever instance serves the request, and no
 * failure ever reaches the request.
 */
import { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { prisma } from "../db/prisma";
import { UserActivityInterceptor } from "../modules/accounts/user_activity.interceptor";
import {
  USER_ACTIVITY_CACHE_MAX,
  USER_ACTIVITY_WRITE_INTERVAL_MS,
  UserActivityService,
} from "../modules/accounts/user_activity.service";

const TEST_PREFIX = `user_activity_${Date.now()}_`;
const USER = `${TEST_PREFIX}user`;
const OTHER = `${TEST_PREFIX}other`;
const GHOST = `${TEST_PREFIX}ghost`;
const MINUTE = 60_000;

const lastActive = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).lastActiveAt;

describe("UserActivityService (integration)", () => {
  let service: UserActivityService;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [USER, OTHER].map((id) => ({ id, email: `${id}@test.resonate` })),
    });
  });
  beforeEach(async () => {
    service = new UserActivityService();
    await prisma.user.updateMany({
      where: { id: { in: [USER, OTHER] } },
      data: { lastActiveAt: null, lastSignInAt: null },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
    await prisma.$disconnect();
  });

  it("writes on the first touch", async () => {
    const t0 = new Date("2026-10-16T10:00:00.000Z");
    await service.touch(USER, t0);
    expect((await lastActive(USER))!.toISOString()).toBe(t0.toISOString());
  });

  it("does not write again within the hour (the database value stays unchanged)", async () => {
    const t0 = new Date("2026-10-16T10:00:00.000Z");
    await service.touch(USER, t0);

    const spy = jest.spyOn(prisma.user, "updateMany");
    try {
      await service.touch(USER, new Date(t0.getTime() + 30 * MINUTE));
      await service.touch(USER, new Date(t0.getTime() + 59 * MINUTE));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect((await lastActive(USER))!.toISOString()).toBe(t0.toISOString());
  });

  it("writes again once more than an hour has passed", async () => {
    const t0 = new Date("2026-10-16T10:00:00.000Z");
    await service.touch(USER, t0);
    const t1 = new Date(t0.getTime() + USER_ACTIVITY_WRITE_INTERVAL_MS + MINUTE);
    await service.touch(USER, t1);
    expect((await lastActive(USER))!.toISOString()).toBe(t1.toISOString());
  });

  it("guards in the database too, so a second instance does not write inside the hour", async () => {
    const t0 = new Date("2026-10-16T10:00:00.000Z");
    await service.touch(USER, t0);

    // A different process: an empty in-memory cache, the same database.
    const otherInstance = new UserActivityService();
    await otherInstance.touch(USER, new Date(t0.getTime() + 20 * MINUTE));
    expect((await lastActive(USER))!.toISOString()).toBe(t0.toISOString());

    await otherInstance.touch(USER, new Date(t0.getTime() + 2 * 60 * MINUTE));
    expect((await lastActive(USER))!.getTime()).toBe(t0.getTime() + 2 * 60 * MINUTE);
  });

  it("tracks each person separately", async () => {
    const t0 = new Date("2026-10-16T10:00:00.000Z");
    await service.touch(USER, t0);
    await service.touch(OTHER, new Date(t0.getTime() + 5 * MINUTE));
    expect((await lastActive(OTHER))!.getTime()).toBe(t0.getTime() + 5 * MINUTE);
  });

  it("does nothing for an unknown user and does not throw", async () => {
    await expect(service.touch(GHOST)).resolves.toBeUndefined();
    await expect(service.touch("")).resolves.toBeUndefined();
  });

  describe("failure", () => {
    it("never throws into the request, logs a warning without the user id, and retries on the next touch", async () => {
      const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
      const update = jest
        .spyOn(prisma.user, "updateMany")
        .mockRejectedValueOnce(new Error(`connection lost for ${USER}`));
      try {
        await expect(service.touch(USER, new Date("2026-10-16T10:00:00.000Z"))).resolves.toBeUndefined();
        const lines = info.mock.calls.map((call) => String(call[0]));
        expect(lines.some((line) => line.includes("accounts.user_activity.touch_failed"))).toBe(true);
        expect(lines.join("\n")).not.toContain(USER);
        expect(lines.join("\n")).toContain('"WARNING"');
      } finally {
        update.mockRestore();
        info.mockRestore();
      }
      // The failed attempt was forgotten, so this touch is not suppressed for an hour.
      const t1 = new Date("2026-10-16T10:05:00.000Z");
      await service.touch(USER, t1);
      expect((await lastActive(USER))!.toISOString()).toBe(t1.toISOString());
    });
  });

  describe("recordSignIn", () => {
    it("stamps sign-in and activity together and seeds the touch cache", async () => {
      const t0 = new Date("2026-10-16T10:00:00.000Z");
      await service.recordSignIn(USER, t0);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: USER } });
      expect(row.lastSignInAt!.toISOString()).toBe(t0.toISOString());
      expect(row.lastActiveAt!.toISOString()).toBe(t0.toISOString());

      const spy = jest.spyOn(prisma.user, "updateMany");
      try {
        await service.touch(USER, new Date(t0.getTime() + 10 * MINUTE));
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("does not throw when the write fails", async () => {
      const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
      const update = jest.spyOn(prisma.user, "updateMany").mockRejectedValueOnce(new Error("boom"));
      try {
        await expect(service.recordSignIn(USER)).resolves.toBeUndefined();
      } finally {
        update.mockRestore();
        info.mockRestore();
      }
    });
  });

  it("bounds its memory of recent writes", async () => {
    const update = jest.spyOn(prisma.user, "updateMany").mockResolvedValue({ count: 0 });
    try {
      const now = new Date("2026-10-16T10:00:00.000Z");
      for (let i = 0; i < USER_ACTIVITY_CACHE_MAX + 10; i += 1) {
        await service.touch(`${TEST_PREFIX}bulk_${i}`, now);
      }
      const remembered = (service as any).lastWrittenMs as Map<string, number>;
      expect(remembered.size).toBeLessThanOrEqual(USER_ACTIVITY_CACHE_MAX);
    } finally {
      update.mockRestore();
    }
  }, 60_000);
});

describe("UserActivityInterceptor", () => {
  const contextFor = (request: unknown, type = "http") =>
    ({
      getType: () => type,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of("response") };

  it("touches the signed-in caller on any method and passes the request through", () => {
    const touch = jest.fn().mockResolvedValue(undefined);
    const interceptor = new UserActivityInterceptor({ touch } as any);
    for (const method of ["GET", "POST", "DELETE"]) {
      interceptor.intercept(contextFor({ method, user: { userId: "u-1" } }), next);
    }
    expect(touch).toHaveBeenCalledTimes(3);
    expect(touch).toHaveBeenCalledWith("u-1");
  });

  it("records nothing for unauthenticated requests or non-http contexts", () => {
    const touch = jest.fn().mockResolvedValue(undefined);
    const interceptor = new UserActivityInterceptor({ touch } as any);
    interceptor.intercept(contextFor({ method: "GET" }), next);
    interceptor.intercept(contextFor({ method: "GET", user: {} }), next);
    interceptor.intercept(contextFor({ method: "GET", user: { userId: "" } }), next);
    interceptor.intercept(contextFor({ user: { userId: "u-1" } }, "rpc"), next);
    expect(touch).not.toHaveBeenCalled();
  });

  it("does not wait for, or fail on, the write", async () => {
    const touch = jest.fn().mockRejectedValue(new Error("never awaited"));
    const interceptor = new UserActivityInterceptor({ touch } as any);
    // `touch` itself never rejects; even if it did, the response must not wait on it.
    const handled = interceptor.intercept(contextFor({ method: "GET", user: { userId: "u-1" } }), next);
    await expect(
      new Promise((resolve) => handled.subscribe({ next: resolve })),
    ).resolves.toBe("response");
    await Promise.resolve();
  });
});
