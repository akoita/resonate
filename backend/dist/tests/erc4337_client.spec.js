"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const erc4337_client_1 = require("../modules/identity/erc4337/erc4337_client");
describe("erc4337 client", () => {
    it("sends user operation via JSON-RPC", async () => {
        const client = new erc4337_client_1.Erc4337Client("http://localhost:9999", "0xEntry");
        const fetchSpy = jest
            .spyOn(globalThis, "fetch")
            .mockResolvedValue({
            json: async () => ({ jsonrpc: "2.0", id: 1, result: "0xhash" }),
        });
        const result = await client.sendUserOperation({
            sender: "0xsender",
            nonce: "0x0",
            initCode: "0x",
            callData: "0x",
            callGasLimit: "0x1",
            verificationGasLimit: "0x1",
            preVerificationGas: "0x1",
            maxFeePerGas: "0x1",
            maxPriorityFeePerGas: "0x1",
            paymasterAndData: "0x",
            signature: "0x",
        });
        expect(result).toBe("0xhash");
        fetchSpy.mockRestore();
    });
});
