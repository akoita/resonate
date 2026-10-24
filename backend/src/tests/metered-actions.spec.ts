import { ConfigService } from "@nestjs/config";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";
import {
  DEFAULT_LYRIA_RATE_LIMIT,
  DEFAULT_REMIX_GENERATION_RATE_LIMIT,
  LEDGER_REASON,
  METERED_ACTIONS,
  METERED_ACTION_KINDS,
  METERED_WINDOW_HOUR_MS,
  resolveRateLimit,
  unitCostCents,
} from "../modules/credits/metered-actions";
import { GenerationService } from "../modules/generation/generation.service";
import { REMIX_GENERATION_DEFAULT_DURATION_SECONDS } from "../modules/remix/remix-generation.provider";
import { RemixProjectService } from "../modules/remix/remix-project.service";

function creditsAt(priceCentsPer30s: number | undefined) {
  const config = {
    get: (key: string, fallback?: unknown) =>
      key === "GENERATION_PRICE_CENTS_PER_30S" && priceCentsPer30s !== undefined
        ? priceCentsPer30s
        : fallback,
  } as unknown as ConfigService;
  return new GenerationCreditsService(config);
}

describe("metered-action registry (#1422)", () => {
  it("describes exactly the kinds the credit ledger can debit", () => {
    expect([...METERED_ACTION_KINDS].sort()).toEqual(["lyria", "remix_draft"]);
    for (const kind of METERED_ACTION_KINDS) {
      expect(METERED_ACTIONS[kind].kind).toBe(kind);
      expect(METERED_ACTIONS[kind].label.length).toBeGreaterThan(0);
    }
  });

  it("attributes every debit-site ledger reason to exactly one kind", () => {
    const owners = new Map<string, string>();
    for (const kind of METERED_ACTION_KINDS) {
      for (const reason of METERED_ACTIONS[kind].ledgerReasons) {
        expect(owners.has(reason)).toBe(false);
        owners.set(reason, kind);
      }
    }
    expect(owners.get(LEDGER_REASON.lyriaGeneration)).toBe("lyria");
    expect(owners.get(LEDGER_REASON.remixDraft)).toBe("remix_draft");
    expect(owners.get(LEDGER_REASON.remixPart)).toBe("remix_draft");
  });

  describe("per-unit cost parity with the credits service", () => {
    it.each([10, 7, 25, 1])(
      "unitCostCents matches costForDurationCents(unit) at price %s",
      (price) => {
        const credits = creditsAt(price);
        for (const kind of METERED_ACTION_KINDS) {
          const { unitSeconds } = METERED_ACTIONS[kind].cost;
          expect(unitCostCents(kind, price)).toBe(
            credits.costForDurationCents(unitSeconds),
          );
        }
      },
    );

    it("quotes the documented default price (10 cents per 30 s block)", () => {
      const credits = creditsAt(undefined);
      expect(credits.costForDurationCents(30)).toBe(10);
      expect(unitCostCents("lyria", 10)).toBe(10);
      expect(unitCostCents("remix_draft", 10)).toBe(10);
    });

    it("prices the default duration the debit sites use", () => {
      const credits = creditsAt(undefined);
      for (const kind of METERED_ACTION_KINDS) {
        const { defaultDurationSeconds } = METERED_ACTIONS[kind].cost;
        expect(credits.costForDurationCents(defaultDurationSeconds)).toBe(
          unitCostCents(kind, 10),
        );
      }
    });

    it("keeps the remix default duration in step with the provider constant", () => {
      expect(METERED_ACTIONS.remix_draft.cost.defaultDurationSeconds).toBe(
        REMIX_GENERATION_DEFAULT_DURATION_SECONDS,
      );
    });
  });

  describe("resolveRateLimit", () => {
    it("falls back to the registry default for unset or invalid values", () => {
      for (const raw of [undefined, null, "", "abc", "0", "-3", 0, -1, NaN]) {
        expect(resolveRateLimit("lyria", raw)).toEqual({
          limit: 50,
          windowMs: METERED_WINDOW_HOUR_MS,
        });
      }
    });

    it("accepts a positive numeric or numeric-string override", () => {
      expect(resolveRateLimit("remix_draft", "25")?.limit).toBe(25);
      expect(resolveRateLimit("remix_draft", 7)?.limit).toBe(7);
    });
  });

  describe("the enforcing services read the registry", () => {
    it("pins the documented defaults (50/hr catalog, 10/hr remix)", () => {
      expect(DEFAULT_LYRIA_RATE_LIMIT).toBe(50);
      expect(DEFAULT_REMIX_GENERATION_RATE_LIMIT).toBe(10);
      expect(METERED_ACTIONS.lyria.rateLimit).toEqual({
        limit: 50,
        windowMs: 3_600_000,
        envKey: "STRIKE_RATE_LIMIT",
      });
      expect(METERED_ACTIONS.remix_draft.rateLimit).toEqual({
        limit: 10,
        windowMs: 3_600_000,
        envKey: "REMIX_GENERATION_RATE_LIMIT",
      });
    });

    it("catalog generation enforces the registry limit and window", () => {
      const service = new GenerationService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { get: () => undefined } as unknown as ConfigService,
        {} as never,
        {} as never,
      );
      const status = service.getGenerationRateLimitStatus("u");
      expect(status.limit).toBe(METERED_ACTIONS.lyria.rateLimit!.limit);
      expect(status.windowMs).toBe(METERED_ACTIONS.lyria.rateLimit!.windowMs);
    });

    it("catalog generation honours the registry env key override", () => {
      const envKey = METERED_ACTIONS.lyria.rateLimit!.envKey;
      const service = new GenerationService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {
          get: (key: string) => (key === envKey ? "5" : undefined),
        } as unknown as ConfigService,
        {} as never,
        {} as never,
      );
      expect(service.getGenerationRateLimitStatus("u").limit).toBe(5);
    });

    describe("remix generation", () => {
      const envKey = METERED_ACTIONS.remix_draft.rateLimit!.envKey;
      const saved = process.env[envKey];
      afterEach(() => {
        if (saved === undefined) delete process.env[envKey];
        else process.env[envKey] = saved;
      });

      function remixService() {
        const stubs = new Array(
          RemixProjectService.length,
        ).fill({}) as never[];
        return new (RemixProjectService as unknown as new (
          ...args: never[]
        ) => RemixProjectService)(...stubs);
      }

      it("enforces the registry limit and window by default", () => {
        delete process.env[envKey];
        const status = remixService().getGenerationRateLimitStatus("u");
        expect(status.limit).toBe(METERED_ACTIONS.remix_draft.rateLimit!.limit);
        expect(status.windowMs).toBe(
          METERED_ACTIONS.remix_draft.rateLimit!.windowMs,
        );
      });

      it("honours the registry env key override", () => {
        process.env[envKey] = "4";
        expect(remixService().getGenerationRateLimitStatus("u").limit).toBe(4);
      });
    });
  });
});
