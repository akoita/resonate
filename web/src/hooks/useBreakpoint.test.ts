import { describe, expect, it } from "vitest";
import { getBreakpoint, PHONE_MAX, TABLET_MAX } from "./useBreakpoint";

describe("getBreakpoint", () => {
  it("classifies phone viewports (<=767px)", () => {
    expect(getBreakpoint(320)).toBe("phone");
    expect(getBreakpoint(375)).toBe("phone");
    expect(getBreakpoint(PHONE_MAX)).toBe("phone");
  });

  it("classifies tablet viewports (768–1279px)", () => {
    expect(getBreakpoint(PHONE_MAX + 1)).toBe("tablet");
    expect(getBreakpoint(900)).toBe("tablet");
    expect(getBreakpoint(TABLET_MAX)).toBe("tablet");
  });

  it("classifies desktop viewports (>=1280px)", () => {
    expect(getBreakpoint(TABLET_MAX + 1)).toBe("desktop");
    expect(getBreakpoint(1440)).toBe("desktop");
    expect(getBreakpoint(2560)).toBe("desktop");
  });
});
