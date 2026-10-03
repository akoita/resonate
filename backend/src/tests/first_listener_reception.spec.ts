import { parseDiscoveryMinimumAudience } from "../modules/recommendations/first_listener_reception.service";

describe("first-listener reception threshold", () => {
  it("accepts only a positive safe integer", () => {
    expect(parseDiscoveryMinimumAudience("5")).toBe(5);
    expect(parseDiscoveryMinimumAudience(" 12 ")).toBe(12);
    expect(parseDiscoveryMinimumAudience("0")).toBe(3);
    expect(parseDiscoveryMinimumAudience("5oops")).toBe(3);
    expect(parseDiscoveryMinimumAudience("1.5")).toBe(3);
    expect(parseDiscoveryMinimumAudience("9007199254740992")).toBe(3);
    expect(parseDiscoveryMinimumAudience(undefined)).toBe(3);
  });
});
