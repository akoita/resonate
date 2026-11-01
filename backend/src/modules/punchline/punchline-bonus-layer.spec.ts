import { setBonusSourceLayer } from "./punchline-unlock.service";

describe("setBonusSourceLayer (#2522)", () => {
  it("cuts the bonus from the layer most moments use", () => {
    expect(setBonusSourceLayer(["full", "full", "drums"])).toBe("full");
    expect(setBonusSourceLayer(["guitar"])).toBe("guitar");
  });

  it("breaks ties toward vocals, then the earliest moment's layer", () => {
    expect(setBonusSourceLayer(["drums", "vocals"])).toBe("vocals");
    expect(setBonusSourceLayer(["drums", "full"])).toBe("drums");
  });

  it("falls back to vocals with no moments or blank layers", () => {
    expect(setBonusSourceLayer([])).toBe("vocals");
    expect(setBonusSourceLayer([null, ""])).toBe("vocals");
  });
});
