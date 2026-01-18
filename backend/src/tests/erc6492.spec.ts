import { isErc6492, unwrapErc6492, wrapErc6492 } from "../modules/identity/erc6492/erc6492";

describe("erc6492", () => {
  it("wraps and unwraps signatures", () => {
    const deployment = "0x1234";
    const sig = "0xaaaa";
    const wrapped = wrapErc6492(sig, deployment);
    expect(isErc6492(wrapped)).toBe(true);
    const unwrapped = unwrapErc6492(wrapped);
    expect(unwrapped.signature).toBe("0xaaaa");
  });
});
