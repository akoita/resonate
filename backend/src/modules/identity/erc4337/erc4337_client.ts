type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
};

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
};

export interface UserOperation {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  paymasterAndData: string;
  signature: string;
}

export class Erc4337Client {
  constructor(private readonly bundlerUrl: string, private readonly entryPoint: string) {}

  async sendUserOperation(op: UserOperation) {
    return this.sendRpc<string>("eth_sendUserOperation", [op, this.entryPoint]);
  }

  async getUserOperationReceipt(userOpHash: string) {
    return this.sendRpc<unknown>("eth_getUserOperationReceipt", [userOpHash]);
  }

  private async sendRpc<T>(method: string, params: unknown[]) {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    };
    const response = await fetch(this.bundlerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const payload = (await response.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new Error(payload.error.message);
    }
    if (payload.result === undefined) {
      throw new Error("Empty JSON-RPC result");
    }
    return payload.result;
  }
}
