/**
 * Per-user rate limits count per person (#309 app half).
 *
 * The global throttler runs before a route's AuthGuard, so it used to see no
 * `req.user` and count every "per user" limit by address. These tests drive a
 * real app with the production guard and storage wiring and show that two
 * people behind one address get separate budgets, that a forged token is
 * counted by address, and that the route's own guard still refuses it.
 */
import { Controller, INestApplication, Post, UseGuards } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard, PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { Throttle, ThrottlerModule, ThrottlerStorageService } from "@nestjs/throttler";
import { sign } from "jsonwebtoken";
import request from "supertest";
import { JwtStrategy } from "../modules/auth/jwt.strategy";
import { RolesGuard } from "../modules/auth/roles.guard";
import { minutes, trackByUser } from "../modules/shared/rate_limits";
import { UserAwareThrottlerGuard } from "../modules/shared/user_aware_throttler.guard";
import { applyTrustProxy } from "../config/trust_proxy";
import { authToken, TEST_JWT_SECRET } from "./e2e-helpers";

@Controller("limited")
class LimitedController {
  @UseGuards(AuthGuard("jwt"))
  @Throttle({ default: { limit: 2, ttl: minutes(1), getTracker: trackByUser } })
  @Post()
  hit() {
    return { ok: true };
  }

  @Throttle({ default: { limit: 2, ttl: minutes(1), getTracker: trackByUser } })
  @Post("public")
  publicHit() {
    return { ok: true };
  }
}

describe("UserAwareThrottlerGuard", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [() => ({ JWT_SECRET: TEST_JWT_SECRET })] }),
        PassportModule.register({ defaultStrategy: "jwt" }),
        JwtModule.register({ secret: TEST_JWT_SECRET }),
        ThrottlerModule.forRoot({
          throttlers: [{ limit: 1_000, ttl: minutes(1) }],
          storage: new ThrottlerStorageService(),
        }),
      ],
      controllers: [LimitedController],
      providers: [
        JwtStrategy,
        // The same order as AppModule.
        { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    // One proxy in front, as behind a load balancer.
    applyTrustProxy(app.getHttpAdapter().getInstance(), { TRUST_PROXY_HOPS: "1" });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).post(path);
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
  };

  it("gives two signed-in people behind one address their own budgets", async () => {
    const alice = authToken("0x00000000000000000000000000000000000a11ce");
    const bob = authToken("0x0000000000000000000000000000000000000b0b");

    await post("/limited", alice).expect(201);
    await post("/limited", alice).expect(201);
    await post("/limited", alice).expect(429);

    // Same address as Alice; before the fix this was refused too.
    await post("/limited", bob).expect(201);
    await post("/limited", bob).expect(201);
    await post("/limited", bob).expect(429);
  });

  it("counts a forged token by address, and the route still refuses it", async () => {
    const forged = sign({ sub: "0x000000000000000000000000000000000000f00d" }, "not-the-secret");
    await post("/limited", forged).expect(401);
    await post("/limited", forged).expect(401);
    // Third request from this address: the address bucket is spent.
    await post("/limited", forged).expect(429);
  });

  it("counts anonymous requests by address", async () => {
    await post("/limited/public").expect(201);
    await post("/limited/public").expect(201);
    await post("/limited/public").expect(429);
  });

  it("tells anonymous clients apart by the address the proxy reports", async () => {
    await post("/limited/public").set("X-Forwarded-For", "198.51.100.1").expect(201);
    await post("/limited/public").set("X-Forwarded-For", "198.51.100.1").expect(201);
    await post("/limited/public").set("X-Forwarded-For", "198.51.100.1").expect(429);
    await post("/limited/public").set("X-Forwarded-For", "198.51.100.2").expect(201);
  });

  it("keeps a person's budget when they move between addresses", async () => {
    const carol = authToken("0x00000000000000000000000000000000000ca401");
    await post("/limited", carol).set("X-Forwarded-For", "203.0.113.1").expect(201);
    await post("/limited", carol).set("X-Forwarded-For", "203.0.113.2").expect(201);
    await post("/limited", carol).set("X-Forwarded-For", "203.0.113.3").expect(429);
  });
});
