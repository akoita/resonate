"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Erc4337Client = void 0;
class Erc4337Client {
    constructor(bundlerUrl, entryPoint) {
        this.bundlerUrl = bundlerUrl;
        this.entryPoint = entryPoint;
    }
    async sendUserOperation(op) {
        return this.sendRpc("eth_sendUserOperation", [op, this.entryPoint]);
    }
    async getUserOperationReceipt(userOpHash) {
        return this.sendRpc("eth_getUserOperationReceipt", [userOpHash]);
    }
    async waitForReceipt(userOpHash, attempts = 10, delayMs = 500) {
        for (let i = 0; i < attempts; i += 1) {
            const receipt = await this.getUserOperationReceipt(userOpHash);
            if (receipt) {
                return receipt;
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return null;
    }
    async sendRpc(method, params) {
        const request = {
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
        const payload = (await response.json());
        if (payload.error) {
            throw new Error(payload.error.message);
        }
        if (payload.result === undefined) {
            throw new Error("Empty JSON-RPC result");
        }
        return payload.result;
    }
}
exports.Erc4337Client = Erc4337Client;
