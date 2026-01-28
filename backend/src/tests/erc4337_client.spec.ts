import { Erc4337Client } from "../modules/identity/erc4337/erc4337_client";

describe("erc4337 client", () => {
  it("sends user operation via JSON-RPC", async () => {
    const client = new Erc4337Client("http://localhost:9999", "0xEntry");
    const fetchSpy = jest
      .spyOn(globalThis as any, "fetch")
      .mockResolvedValue({
        json: async () => ({ jsonrpc: "2.0", id: 1, result: "0xhash" }),
      });

    const result = await client.sendUserOperation({
      sender: "0xsender",
      nonce: "0x0",
      factory: null,
      factoryData: "0x",
      callData: "0x",
      callGasLimit: "0x1",
      verificationGasLimit: "0x1",
      preVerificationGas: "0x1",
      maxFeePerGas: "0x1",
      maxPriorityFeePerGas: "0x1",
      paymaster: null,
      paymasterVerificationGasLimit: "0x0",
      paymasterPostOpGasLimit: "0x0",
      paymasterData: "0x",
      signature: "0x",
    });

    expect(result).toBe("0xhash");
    fetchSpy.mockRestore();
  });
});
