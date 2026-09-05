#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";

const DEFAULT_ANVIL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function readConfig(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function required(config, name) {
  const value = process.env[name] ?? config[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateKey(value, name) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte 0x-prefixed private key`);
  }
  return value;
}

const config = readConfig(
  process.env.AA_CONFIG_FILE ?? resolve(process.cwd(), "../backend/.env"),
);
const chainId = Number(required(config, "AA_CHAIN_ID"));
if (!Number.isSafeInteger(chainId) || chainId <= 0) {
  throw new Error("AA_CHAIN_ID must be a positive safe integer");
}

const rpcUrl = process.env.AA_RPC_URL ?? config.AA_RPC_URL ?? config.RPC_URL;
if (!rpcUrl) throw new Error("AA_RPC_URL (or RPC_URL in the config file) is required");
const bundlerUrl = process.env.AA_BUNDLER_URL ?? config.AA_BUNDLER;
if (!bundlerUrl) throw new Error("AA_BUNDLER_URL (or AA_BUNDLER in the config file) is required");
const entryPoint = {
  address: getAddress(required(config, "AA_ENTRY_POINT")),
  version: "0.7",
};
const kernelVersion = required(config, "AA_KERNEL_VERSION");
if (kernelVersion !== "0.3.1") {
  throw new Error(`AA_KERNEL_VERSION must be 0.3.1, received ${kernelVersion}`);
}

const smokeKeyValue = process.env.AA_SMOKE_PRIVATE_KEY ??
  (chainId === 31337 ? DEFAULT_ANVIL_PRIVATE_KEY : undefined);
if (!smokeKeyValue) throw new Error("AA_SMOKE_PRIVATE_KEY is required outside Anvil");
const funderKeyValue = process.env.AA_FUNDER_KEY ?? smokeKeyValue;
const signer = privateKeyToAccount(privateKey(smokeKeyValue, "AA_SMOKE_PRIVATE_KEY"));
const funder = privateKeyToAccount(privateKey(funderKeyValue, "AA_FUNDER_KEY"));

const chain = defineChain({
  id: chainId,
  name: process.env.AA_NETWORK_NAME ?? `local-aa-${chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({
  account: funder,
  chain,
  transport: http(rpcUrl),
});

const validator = await signerToEcdsaValidator(publicClient, {
  signer,
  entryPoint,
  kernelVersion,
  validatorAddress: getAddress(required(config, "AA_ECDSA_VALIDATOR")),
});
const account = await createKernelAccount(publicClient, {
  plugins: { sudo: validator },
  entryPoint,
  kernelVersion,
  accountImplementationAddress: getAddress(required(config, "AA_KERNEL")),
  factoryAddress: getAddress(required(config, "AA_FACTORY")),
  useMetaFactory: false,
});

const accountAddress = account.address;
const fundingHash = await walletClient.sendTransaction({
  to: accountAddress,
  value: parseEther(process.env.AA_SMOKE_FUNDING_ETH ?? "0.1"),
});
await publicClient.waitForTransactionReceipt({ hash: fundingHash });

const client = createKernelAccountClient({
  account,
  chain,
  client: publicClient,
  bundlerTransport: http(bundlerUrl),
  userOperation: {
    estimateFeesPerGas: async () => {
      const gasPrice = await publicClient.getGasPrice();
      return { maxFeePerGas: gasPrice * 2n, maxPriorityFeePerGas: gasPrice };
    },
  },
});

const userOperationHash = await client.sendUserOperation({
  calls: [{ to: signer.address, value: 0n, data: "0x" }],
});
const userOperationReceipt = await client.waitForUserOperationReceipt({
  hash: userOperationHash,
  timeout: 120_000,
});
const transactionReceipt = await publicClient.getTransactionReceipt({
  hash: userOperationReceipt.receipt.transactionHash,
});
if (transactionReceipt.status !== "success" || !userOperationReceipt.success) {
  throw new Error(`UserOperation failed in transaction ${transactionReceipt.transactionHash}`);
}

console.log(JSON.stringify({
  chainId,
  account: accountAddress,
  userOperationHash,
  transactionHash: transactionReceipt.transactionHash,
  blockNumber: transactionReceipt.blockNumber.toString(),
  success: true,
}, null, 2));
