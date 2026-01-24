"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const erc6492_1 = require("../modules/identity/erc6492/erc6492");
describe("erc6492", () => {
    it("wraps and unwraps signatures", () => {
        const deployment = "0x" + "0".repeat(64);
        const sig = "0xaaaa";
        const wrapped = (0, erc6492_1.wrapErc6492)(sig, deployment);
        expect((0, erc6492_1.isErc6492)(wrapped)).toBe(true);
        const unwrapped = (0, erc6492_1.unwrapErc6492)(wrapped);
        expect(unwrapped.signature).toBe("0xaaaa");
        expect(unwrapped.deploymentData).toBe(deployment);
    });
});
