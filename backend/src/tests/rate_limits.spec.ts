import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
  THROTTLER_TRACKER,
} from "@nestjs/throttler/dist/throttler.constants";
import { GLOBAL_RATE_LIMIT, hours, minutes, seconds } from "../modules/shared/rate_limits";
import { AuthController } from "../modules/auth/auth.controller";
import { ArtistController } from "../modules/artist/artist.controller";
import { CurationController } from "../modules/curation/curation.controller";
import { GenerationController } from "../modules/generation/generation.controller";
import { IngestionController } from "../modules/ingestion/ingestion.controller";
import { PrivacyController } from "../modules/privacy/privacy.controller";

const THROTTLED_CONTROLLERS = [
  AuthController,
  ArtistController,
  CurationController,
  GenerationController,
  IngestionController,
  PrivacyController,
];

function throttledHandlers(controller: { prototype: object }) {
  const found: Array<{ handler: string; ttl: number }> = [];
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    if (name === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(controller.prototype, name);
    const method = descriptor?.value;
    if (typeof method !== "function") continue;
    const ttl = Reflect.getMetadata(`${THROTTLER_TTL}default`, method);
    if (typeof ttl === "number") {
      found.push({ handler: `${controller.constructor.name}.${name}`, ttl });
    }
  }
  return found;
}

describe("rate limit windows", () => {
  it("states its unit", () => {
    expect(seconds(60)).toBe(60_000);
    expect(minutes(1)).toBe(60_000);
    expect(hours(1)).toBe(3_600_000);
  });

  /**
   * The regression this file exists for (#1790). `ttl` is milliseconds, so a
   * second-shaped value like `60` is a window of 60ms — a limit that never
   * engages, looks deliberate in review, and cannot be told apart from a
   * working one without reading the installed library or timing a request.
   *
   * Nothing here asserts a specific window: the point is that no route can
   * carry one shorter than a second, whatever its intended size.
   */
  it("gives every throttled route a window longer than a second", () => {
    const handlers = THROTTLED_CONTROLLERS.flatMap(throttledHandlers);
    expect(handlers.length).toBeGreaterThanOrEqual(9);

    const subSecond = handlers.filter((entry) => entry.ttl < 1_000);
    expect(subSecond).toEqual([]);
  });

  it("keeps the global backstop on the same footing", () => {
    expect(GLOBAL_RATE_LIMIT.ttl).toBeGreaterThanOrEqual(1_000);
    // Generous on purpose — it is tracked per IP and guards every route at
    // once, so it stops a runaway client rather than protecting an endpoint.
    expect(GLOBAL_RATE_LIMIT.limit).toBeGreaterThanOrEqual(600);
  });

  it("limits artist claim submissions to five per claimant per hour", () => {
    const handler = ArtistController.prototype.submitClaim;
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(5);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(hours(1));

    const getTracker = Reflect.getMetadata(
      `${THROTTLER_TRACKER}default`,
      handler,
    ) as (req: Record<string, any>) => string;
    expect(getTracker({ user: { userId: "user-1" }, ip: "127.0.0.1" })).toBe("user-1");
    expect(getTracker({ ip: "127.0.0.1" })).toBe("127.0.0.1");
  });
});
