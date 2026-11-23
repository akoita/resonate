/** The price-change notice script's arguments (#2597). */
import { parsePriceChangeArgs } from "../scripts/send_price_change_notice";

describe("parsePriceChangeArgs", () => {
  it("parses a valid command", () => {
    expect(parsePriceChangeArgs(["--interval", "year", "--currency", "EUR", "--price-cents", "16990", "--effective", "2026-12-20", "--dry-run"])).toEqual({
      interval: "year",
      currency: "eur",
      newPriceCents: 16990,
      effectiveAt: new Date("2026-12-20T00:00:00Z"),
      dryRun: true,
    });
  });

  it.each([
    [["--interval", "week", "--currency", "usd", "--price-cents", "1", "--effective", "2026-12-20"], "--interval"],
    [["--interval", "month", "--currency", "gbp", "--price-cents", "1", "--effective", "2026-12-20"], "--currency"],
    [["--interval", "month", "--currency", "usd", "--price-cents", "0", "--effective", "2026-12-20"], "--price-cents"],
    [["--interval", "month", "--currency", "usd", "--price-cents", "1699", "--effective", "20 Dec"], "--effective"],
  ])("refuses %j", (argv, message) => {
    expect(() => parsePriceChangeArgs(argv)).toThrow(message);
  });
});
